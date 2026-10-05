import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  announcement,
  assemblyResolution,
  building,
  chargeCall,
  chargePayment,
  chargeReminder,
  generalAssembly,
  residence,
  residenceUnit,
  resident,
  ticket,
  ticketEvent,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { AppError } from "@/lib/result";
import { activeTicketStatuses } from "@/lib/tickets";
import { chargeStatement, liveCalls, paidByUnit } from "@/server/charges/accounts";

import { type PortalCtx, type PortalScope, portalScope } from "./context";
import type { portalTicketSchema } from "./schemas";

const coOwned = (scope: PortalScope) => scope.residents.filter((r) => r.kind === "co_owner");
const unique = (values: string[]) => [...new Set(values)];

/**
 * Charges account of a unit the account co-owns (CLAUDE.md §12: occupants do not see
 * charges): calls, payments with their receipts, reminder letters; null otherwise.
 */
export async function getPortalUnitAccount(ctx: PortalCtx, unitId: string) {
  if (!isUuid(unitId)) return null;
  return withTenant(ctx, async (tx) => {
    const owned = coOwned(await portalScope(tx, ctx)).find((r) => r.unitId === unitId);
    if (!owned) return null;
    const [row] = await tx
      .select({
        residenceName: residence.name,
        shareBasis: residence.shareBasis,
        code: unit.code,
        typology: unit.typology,
        buildingName: building.name,
        share: residenceUnit.share,
      })
      .from(residenceUnit)
      .innerJoin(residence, eq(residence.id, residenceUnit.residenceId))
      .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
      .innerJoin(building, eq(building.id, unit.buildingId))
      .where(
        and(eq(residenceUnit.residenceId, owned.residenceId), eq(residenceUnit.unitId, unitId)),
      );
    if (!row) return null;
    const calls = await liveCalls(tx, owned.residenceId, [unitId]);
    const paid = (await paidByUnit(tx, owned.residenceId, [unitId])).get(unitId) ?? 0n;
    const payments = await tx
      .select({
        id: chargePayment.id,
        receiptNumber: chargePayment.receiptNumber,
        amount: chargePayment.amount,
        method: chargePayment.method,
        paidOn: chargePayment.paidOn,
        chequeClearedOn: chargePayment.chequeClearedOn,
        status: chargePayment.status,
        pdfFileId: chargePayment.pdfFileId,
      })
      .from(chargePayment)
      .where(
        and(eq(chargePayment.residenceId, owned.residenceId), eq(chargePayment.unitId, unitId)),
      )
      .orderBy(desc(chargePayment.paidOn), desc(chargePayment.createdAt));
    const reminders = await tx
      .select({
        id: chargeReminder.id,
        issuedAt: chargeReminder.issuedAt,
        payBy: chargeReminder.payBy,
        overdue: chargeReminder.overdue,
        pdfFileId: chargeReminder.pdfFileId,
      })
      .from(chargeReminder)
      .where(
        and(eq(chargeReminder.residenceId, owned.residenceId), eq(chargeReminder.unitId, unitId)),
      )
      .orderBy(desc(chargeReminder.issuedAt));
    return {
      ...row,
      unitId,
      statement: chargeStatement(calls, paid, todayInAlgiers()),
      payments,
      reminders,
    };
  });
}

export type PortalUnitAccount = NonNullable<Awaited<ReturnType<typeof getPortalUnitAccount>>>;

/** Announcements shown now in the account's residences (co-owners and occupants). */
export async function listPortalAnnouncements(ctx: PortalCtx) {
  return withTenant(ctx, async (tx) => {
    const residenceIds = unique((await portalScope(tx, ctx)).residents.map((r) => r.residenceId));
    if (residenceIds.length === 0) return [];
    return tx
      .select({
        id: announcement.id,
        residenceName: residence.name,
        category: announcement.category,
        title: announcement.title,
        titleAr: announcement.titleAr,
        body: announcement.body,
        bodyAr: announcement.bodyAr,
        pinned: announcement.pinned,
        expiresOn: announcement.expiresOn,
        publishedAt: announcement.publishedAt,
        pdfFileId: announcement.pdfFileId,
      })
      .from(announcement)
      .innerJoin(residence, eq(residence.id, announcement.residenceId))
      .where(
        and(
          inArray(announcement.residenceId, residenceIds),
          sql`${announcement.publishedAt} is not null`,
          isNull(announcement.archivedAt),
          or(isNull(announcement.expiresOn), gte(announcement.expiresOn, todayInAlgiers())),
        ),
      )
      .orderBy(desc(announcement.pinned), desc(announcement.publishedAt));
  });
}

export type PortalAnnouncement = Awaited<ReturnType<typeof listPortalAnnouncements>>[number];

/** Tickets the account reported, or opened on its units. */
function scopeTickets(scope: PortalScope) {
  if (scope.residents.length === 0) return undefined;
  return or(
    inArray(
      ticket.residentId,
      scope.residents.map((r) => r.id),
    ),
    inArray(
      ticket.unitId,
      scope.residents.map((r) => r.unitId),
    ),
  );
}

export async function listPortalTickets(ctx: PortalCtx) {
  return withTenant(ctx, async (tx) => {
    const where = scopeTickets(await portalScope(tx, ctx));
    if (!where) return [];
    return tx
      .select({
        id: ticket.id,
        title: ticket.title,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        residenceName: residence.name,
        unitCode: unit.code,
        createdAt: ticket.createdAt,
      })
      .from(ticket)
      .innerJoin(residence, eq(residence.id, ticket.residenceId))
      .leftJoin(unit, eq(unit.id, ticket.unitId))
      .where(where)
      .orderBy(
        sql`${ticket.status} not in (${sql.join(
          activeTicketStatuses.map((s) => sql`${s}`),
          sql`, `,
        )})`,
        desc(ticket.createdAt),
      );
  });
}

export type PortalTicketRow = Awaited<ReturnType<typeof listPortalTickets>>[number];

/**
 * A ticket of the account with its history: status changes and assignments, not the staff's
 * comments (they were written for the team); null when it is not one of its tickets.
 */
export async function getPortalTicket(ctx: PortalCtx, ticketId: string) {
  if (!isUuid(ticketId)) return null;
  return withTenant(ctx, async (tx) => {
    const where = scopeTickets(await portalScope(tx, ctx));
    if (!where) return null;
    const [row] = await tx
      .select({
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        residenceName: residence.name,
        unitCode: unit.code,
        createdAt: ticket.createdAt,
      })
      .from(ticket)
      .innerJoin(residence, eq(residence.id, ticket.residenceId))
      .leftJoin(unit, eq(unit.id, ticket.unitId))
      .where(and(eq(ticket.id, ticketId), where));
    if (!row) return null;
    const events = await tx
      .select({
        id: ticketEvent.id,
        kind: ticketEvent.kind,
        toStatus: ticketEvent.toStatus,
        assignee: ticketEvent.assignee,
        createdAt: ticketEvent.createdAt,
      })
      .from(ticketEvent)
      .where(and(eq(ticketEvent.ticketId, row.id), sql`${ticketEvent.kind} <> 'comment'`))
      .orderBy(asc(ticketEvent.createdAt));
    return { ...row, events };
  });
}

export type PortalTicket = NonNullable<Awaited<ReturnType<typeof getPortalTicket>>>;

/** Where the account may open a ticket: its units and their residences' common areas. */
export async function listPortalTicketTargets(ctx: PortalCtx) {
  return withTenant(ctx, async (tx) => {
    const { residents } = await portalScope(tx, ctx);
    if (residents.length === 0) return [];
    const rows = await tx
      .select({
        residenceId: residence.id,
        residenceName: residence.name,
        unitId: unit.id,
        unitCode: unit.code,
      })
      .from(resident)
      .innerJoin(residence, eq(residence.id, resident.residenceId))
      .innerJoin(unit, eq(unit.id, resident.unitId))
      .where(
        inArray(
          resident.id,
          residents.map((r) => r.id),
        ),
      )
      .orderBy(asc(residence.name), asc(unit.code));
    return unique(rows.map((r) => r.residenceId)).map((residenceId) => {
      const units = rows.filter((r) => r.residenceId === residenceId);
      return {
        id: residenceId,
        name: units[0]?.residenceName ?? "",
        units: units.map((u) => ({ unitId: u.unitId, code: u.unitCode })),
      };
    });
  });
}

export type PortalTicketTarget = Awaited<ReturnType<typeof listPortalTicketTargets>>[number];

/**
 * A resident reports a problem (CLAUDE.md §12): on one of its units or the common areas of
 * its residence; the ticket names the resident and joins the staff's list.
 */
export async function createPortalTicket(
  ctx: PortalCtx,
  input: z.output<typeof portalTicketSchema>,
) {
  return withTenant(ctx, async (tx) => {
    const { residents } = await portalScope(tx, ctx);
    const here = residents.filter((r) => r.residenceId === input.residenceId);
    if (here.length === 0) throw new AppError("NOT_FOUND");
    const reporter = input.unitId ? here.find((r) => r.unitId === input.unitId) : here[0];
    if (!reporter) {
      throw new AppError("VALIDATION", "residences.errors.unitNotInResidence", {
        fieldErrors: { unitId: ["residences.errors.unitNotInResidence"] },
      });
    }
    const [person] = await tx
      .select({ lastName: resident.lastName, firstName: resident.firstName })
      .from(resident)
      .where(eq(resident.id, reporter.id));
    const [row] = await tx
      .insert(ticket)
      .values({
        organizationId: ctx.orgId,
        residenceId: input.residenceId,
        unitId: input.unitId,
        residentId: reporter.id,
        reporterName: person ? `${person.lastName} ${person.firstName}` : ctx.name,
        title: input.title,
        description: input.description,
        category: input.category,
        priority: input.priority,
        createdBy: ctx.userId,
      })
      .returning({ id: ticket.id });
    if (!row) throw new Error("createPortalTicket: no row returned");
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

/**
 * General assemblies of the residences the account co-owns in: convened ones with their
 * agenda and convocation, closed ones with their results and PV.
 */
export async function listPortalAssemblies(ctx: PortalCtx) {
  return withTenant(ctx, async (tx) => {
    const residenceIds = unique(coOwned(await portalScope(tx, ctx)).map((r) => r.residenceId));
    if (residenceIds.length === 0) return [];
    const assemblies = await tx
      .select({
        id: generalAssembly.id,
        residenceName: residence.name,
        kind: generalAssembly.kind,
        status: generalAssembly.status,
        heldOn: generalAssembly.heldOn,
        startTime: generalAssembly.startTime,
        place: generalAssembly.place,
        convocationFileId: generalAssembly.convocationFileId,
        minutesFileId: generalAssembly.minutesFileId,
      })
      .from(generalAssembly)
      .innerJoin(residence, eq(residence.id, generalAssembly.residenceId))
      .where(
        and(
          inArray(generalAssembly.residenceId, residenceIds),
          inArray(generalAssembly.status, ["convened", "closed"]),
        ),
      )
      .orderBy(desc(generalAssembly.heldOn));
    if (assemblies.length === 0) return [];
    const resolutions = await tx
      .select({
        assemblyId: assemblyResolution.assemblyId,
        position: assemblyResolution.position,
        title: assemblyResolution.title,
        titleAr: assemblyResolution.titleAr,
        majority: assemblyResolution.majority,
        adopted: assemblyResolution.adopted,
      })
      .from(assemblyResolution)
      .where(
        inArray(
          assemblyResolution.assemblyId,
          assemblies.map((a) => a.id),
        ),
      )
      .orderBy(asc(assemblyResolution.position));
    return assemblies.map((a) => ({
      ...a,
      resolutions: resolutions.filter((r) => r.assemblyId === a.id),
    }));
  });
}

export type PortalAssembly = Awaited<ReturnType<typeof listPortalAssemblies>>[number];

/**
 * Whether a residence document may be downloaded by the account: its units' charge calls,
 * receipts and reminder letters (co-owners), its residences' assembly convocations and PVs
 * (co-owners) and published announcement notices (co-owners and occupants).
 */
export async function portalCanReadResidenceFile(tx: Tx, userId: string, fileId: string) {
  const scope = await portalScope(tx, { userId });
  const owned = coOwned(scope);
  const ownedUnits = owned.map((r) => r.unitId);
  const ownedResidences = unique(owned.map((r) => r.residenceId));
  const residences = unique(scope.residents.map((r) => r.residenceId));
  if (residences.length === 0) return false;
  const found = async (rows: PromiseLike<unknown[]>) => (await rows).length > 0;
  if (ownedUnits.length > 0) {
    if (
      (await found(
        tx
          .select({ id: chargeCall.id })
          .from(chargeCall)
          .where(and(eq(chargeCall.pdfFileId, fileId), inArray(chargeCall.unitId, ownedUnits))),
      )) ||
      (await found(
        tx
          .select({ id: chargePayment.id })
          .from(chargePayment)
          .where(
            and(eq(chargePayment.pdfFileId, fileId), inArray(chargePayment.unitId, ownedUnits)),
          ),
      )) ||
      (await found(
        tx
          .select({ id: chargeReminder.id })
          .from(chargeReminder)
          .where(
            and(eq(chargeReminder.pdfFileId, fileId), inArray(chargeReminder.unitId, ownedUnits)),
          ),
      )) ||
      (await found(
        tx
          .select({ id: generalAssembly.id })
          .from(generalAssembly)
          .where(
            and(
              inArray(generalAssembly.residenceId, ownedResidences),
              or(
                eq(generalAssembly.convocationFileId, fileId),
                eq(generalAssembly.minutesFileId, fileId),
              ),
            ),
          ),
      ))
    ) {
      return true;
    }
  }
  return found(
    tx
      .select({ id: announcement.id })
      .from(announcement)
      .where(
        and(
          eq(announcement.pdfFileId, fileId),
          inArray(announcement.residenceId, residences),
          sql`${announcement.publishedAt} is not null`,
        ),
      ),
  );
}
