import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  residence,
  residenceUnit,
  staffMember,
  supplier,
  ticket,
  ticketEvent,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { activeTicketStatuses, type TicketStatus, ticketStatuses } from "@/lib/tickets";
import { assertCan, type TenantCtx } from "@/server/auth/session";

const agent = alias(staffMember, "agent");

/** Tickets list filters, from the URL. */
export type TicketFilters = { residenceId?: string; status?: TicketStatus | "active" };

/** Tickets of the organization (optionally one residence / status), urgent and oldest first. */
export async function listTickets(ctx: TenantCtx, filters: TicketFilters) {
  assertCan(ctx, "ticket:read");
  const residenceId =
    filters.residenceId && isUuid(filters.residenceId) ? filters.residenceId : null;
  const statuses =
    filters.status === "active"
      ? [...activeTicketStatuses]
      : filters.status && ticketStatuses.includes(filters.status)
        ? [filters.status]
        : null;
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: ticket.id,
        residenceId: ticket.residenceId,
        residenceName: residence.name,
        unitCode: unit.code,
        title: ticket.title,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        assignee: sql<
          string | null
        >`coalesce(${agent.lastName} || ' ' || ${agent.firstName}, ${supplier.name})`,
        createdAt: ticket.createdAt,
      })
      .from(ticket)
      .innerJoin(residence, eq(residence.id, ticket.residenceId))
      .leftJoin(unit, eq(unit.id, ticket.unitId))
      .leftJoin(agent, eq(agent.id, ticket.assignedStaffId))
      .leftJoin(supplier, eq(supplier.id, ticket.assignedSupplierId))
      .where(
        and(
          residenceId ? eq(ticket.residenceId, residenceId) : undefined,
          statuses ? inArray(ticket.status, statuses) : undefined,
        ),
      )
      .orderBy(
        sql`case ${ticket.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`,
        asc(ticket.createdAt),
      )
      .limit(500),
  );
}

export type TicketRow = Awaited<ReturnType<typeof listTickets>>[number];

/** A ticket with its residence, unit, assignee and history (oldest first). */
export async function getTicket(ctx: TenantCtx, ticketId: string) {
  assertCan(ctx, "ticket:read");
  if (!isUuid(ticketId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        ticket,
        residenceName: residence.name,
        unitCode: unit.code,
        staffName: sql<string | null>`${agent.lastName} || ' ' || ${agent.firstName}`,
        supplierName: supplier.name,
      })
      .from(ticket)
      .innerJoin(residence, eq(residence.id, ticket.residenceId))
      .leftJoin(unit, eq(unit.id, ticket.unitId))
      .leftJoin(agent, eq(agent.id, ticket.assignedStaffId))
      .leftJoin(supplier, eq(supplier.id, ticket.assignedSupplierId))
      .where(eq(ticket.id, ticketId));
    if (!row) return null;
    const events = await tx
      .select({
        id: ticketEvent.id,
        kind: ticketEvent.kind,
        fromStatus: ticketEvent.fromStatus,
        toStatus: ticketEvent.toStatus,
        assignee: ticketEvent.assignee,
        comment: ticketEvent.comment,
        actorName: user.name,
        createdAt: ticketEvent.createdAt,
      })
      .from(ticketEvent)
      .leftJoin(user, eq(user.id, ticketEvent.actorUserId))
      .where(eq(ticketEvent.ticketId, ticketId))
      .orderBy(asc(ticketEvent.createdAt), asc(ticketEvent.id));
    // Who it can be assigned to: the residence's employed agents, every supplier.
    const staff = await tx
      .select({
        id: staffMember.id,
        name: sql<string>`${staffMember.lastName} || ' ' || ${staffMember.firstName}`,
      })
      .from(staffMember)
      .where(
        and(
          eq(staffMember.residenceId, row.ticket.residenceId),
          isNull(staffMember.deletedAt),
          isNull(staffMember.leftOn),
        ),
      )
      .orderBy(asc(staffMember.lastName));
    const suppliers = await tx
      .select({ id: supplier.id, name: supplier.name })
      .from(supplier)
      .where(isNull(supplier.deletedAt))
      .orderBy(asc(supplier.name));
    return {
      ...row.ticket,
      residenceName: row.residenceName,
      unitCode: row.unitCode,
      assignee: row.staffName ?? row.supplierName,
      events,
      staff,
      suppliers,
    };
  });
}

export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicket>>>;

/** For the new ticket form: live residences with their unit codes. */
export async function listTicketTargets(ctx: TenantCtx) {
  assertCan(ctx, "ticket:create");
  return withTenant(ctx, async (tx) => {
    const residences = await tx
      .select({ id: residence.id, name: residence.name })
      .from(residence)
      .where(isNull(residence.deletedAt))
      .orderBy(asc(residence.name));
    const units = await tx
      .select({ residenceId: residenceUnit.residenceId, unitId: unit.id, code: unit.code })
      .from(residenceUnit)
      .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
      .orderBy(asc(unit.code));
    return residences.map((r) => ({
      ...r,
      units: units
        .filter((u) => u.residenceId === r.id)
        .map(({ unitId, code }) => ({ unitId, code })),
    }));
  });
}

export type TicketTarget = Awaited<ReturnType<typeof listTicketTargets>>[number];

/** Open tickets count per residence (sheet badges, dashboard). */
export async function countActiveTickets(ctx: TenantCtx) {
  assertCan(ctx, "ticket:read");
  return withTenant(ctx, (tx) =>
    tx
      .select({ residenceId: ticket.residenceId, n: sql<number>`count(*)::int` })
      .from(ticket)
      .where(inArray(ticket.status, [...activeTicketStatuses]))
      .groupBy(ticket.residenceId)
      .orderBy(desc(sql`count(*)`)),
  );
}
