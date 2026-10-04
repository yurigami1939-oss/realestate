import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { residenceUnit, staffMember, supplier, ticket, ticketEvent } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { ticketTransitions } from "@/lib/tickets";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadResidence } from "@/server/residences/service";

import type {
  assignTicketSchema,
  changeTicketStatusSchema,
  commentTicketSchema,
  createTicketSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** Opens a ticket on a unit of the residence or its common areas (ticket:create). */
export async function createTicket(ctx: TenantCtx, input: In<typeof createTicketSchema>) {
  assertCan(ctx, "ticket:create");
  return withTenant(ctx, async (tx) => {
    const home = await loadResidence(tx, input.residenceId);
    if (input.unitId) {
      const [member] = await tx
        .select({ unitId: residenceUnit.unitId })
        .from(residenceUnit)
        .where(and(eq(residenceUnit.residenceId, home.id), eq(residenceUnit.unitId, input.unitId)));
      if (!member) throw invalid("unitId", "residences.errors.unitNotInResidence");
    }
    const [row] = await tx
      .insert(ticket)
      .values({ ...input, organizationId: ctx.orgId, residenceId: home.id, createdBy: ctx.userId })
      .returning({ id: ticket.id });
    if (!row) throw new Error("createTicket: no row returned");
    await tx.insert(ticketEvent).values({
      organizationId: ctx.orgId,
      ticketId: row.id,
      kind: "created",
      toStatus: "open",
      comment: input.description,
      actorUserId: ctx.userId,
    });
    return { id: row.id };
  });
}

async function loadTicket(tx: Tx, ticketId: string) {
  const [row] = await tx.select().from(ticket).where(eq(ticket.id, ticketId)).for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** Moves a ticket along its workflow (`ticketTransitions`), with an optional comment. */
export async function changeTicketStatus(
  ctx: TenantCtx,
  input: In<typeof changeTicketStatusSchema>,
) {
  assertCan(ctx, "ticket:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadTicket(tx, input.ticketId);
    if (!ticketTransitions[current.status].includes(input.status)) {
      throw new AppError("INVALID_TRANSITION", "tickets.errors.invalidTransition");
    }
    const now = new Date();
    await tx
      .update(ticket)
      .set({
        status: input.status,
        resolvedAt:
          input.status === "resolved" ? now : input.status === "in_progress" ? null : undefined,
        closedAt: input.status === "closed" ? now : undefined,
      })
      .where(eq(ticket.id, current.id));
    await tx.insert(ticketEvent).values({
      organizationId: ctx.orgId,
      ticketId: current.id,
      kind: "status",
      fromStatus: current.status,
      toStatus: input.status,
      comment: input.comment,
      actorUserId: ctx.userId,
    });
  });
}

/** Assigns a ticket to an agent of its residence or a supplier (or nobody). */
export async function assignTicket(ctx: TenantCtx, input: In<typeof assignTicketSchema>) {
  assertCan(ctx, "ticket:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadTicket(tx, input.ticketId);
    if (current.status === "closed" || current.status === "cancelled") {
      throw new AppError("CONFLICT", "tickets.errors.ticketClosed");
    }
    let assignee: string | null = null;
    if (input.staffId) {
      const [agent] = await tx
        .select({ lastName: staffMember.lastName, firstName: staffMember.firstName })
        .from(staffMember)
        .where(
          and(
            eq(staffMember.id, input.staffId),
            eq(staffMember.residenceId, current.residenceId),
            isNull(staffMember.deletedAt),
          ),
        );
      if (!agent) throw invalid("staffId", "tickets.errors.assigneeNotFound");
      assignee = `${agent.lastName} ${agent.firstName}`;
    }
    if (input.supplierId) {
      const [company] = await tx
        .select({ name: supplier.name })
        .from(supplier)
        .where(and(eq(supplier.id, input.supplierId), isNull(supplier.deletedAt)));
      if (!company) throw invalid("supplierId", "tickets.errors.assigneeNotFound");
      assignee = company.name;
    }
    await tx
      .update(ticket)
      .set({ assignedStaffId: input.staffId, assignedSupplierId: input.supplierId })
      .where(eq(ticket.id, current.id));
    await tx.insert(ticketEvent).values({
      organizationId: ctx.orgId,
      ticketId: current.id,
      kind: "assigned",
      assignee,
      actorUserId: ctx.userId,
    });
  });
}

/** Adds a comment to a ticket's history. */
export async function commentTicket(ctx: TenantCtx, input: In<typeof commentTicketSchema>) {
  assertCan(ctx, "ticket:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadTicket(tx, input.ticketId);
    await tx.insert(ticketEvent).values({
      organizationId: ctx.orgId,
      ticketId: current.id,
      kind: "comment",
      comment: input.comment,
      actorUserId: ctx.userId,
    });
  });
}
