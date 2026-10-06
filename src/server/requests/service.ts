import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  buyer,
  portalRequest,
  project,
  reservation,
  reservationBuyer,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import type { PortalCtx } from "@/server/portal/context";
import { isPortalSale } from "@/server/portal/sales";
import { loadVisibleReservation, visibleSales } from "@/server/sales/access";

import {
  type closePortalRequestSchema,
  type createPortalRequestSchema,
  REQUESTS_PAGE_SIZE,
  type RequestListParams,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Open requests a buyer may have waiting on one sale. */
const MAX_OPEN_PER_SALE = 5;

/**
 * A buyer asks, about one of their live sales, for an attestation, an appointment or anything
 * else (CLAUDE.md §7 Portal); staff see it on their list and dashboard. Audited.
 */
export async function createPortalRequest(
  ctx: PortalCtx,
  input: In<typeof createPortalRequestSchema>,
) {
  return withTenant(ctx, async (tx) => {
    if (!(await isPortalSale(tx, ctx.userId, input.reservationId))) {
      throw new AppError("NOT_FOUND");
    }
    const [sale] = await tx
      .select({ status: reservation.status })
      .from(reservation)
      .where(eq(reservation.id, input.reservationId));
    if (sale?.status === "withdrawn") throw new AppError("CONFLICT", "sales.errors.closed");
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(portalRequest)
      .where(
        and(eq(portalRequest.reservationId, input.reservationId), eq(portalRequest.status, "open")),
      );
    if ((open?.n ?? 0) >= MAX_OPEN_PER_SALE) {
      throw new AppError("CONFLICT", "requests.errors.tooMany");
    }
    const [row] = await tx
      .insert(portalRequest)
      .values({
        organizationId: ctx.orgId,
        reservationId: input.reservationId,
        userId: ctx.userId,
        kind: input.kind,
        certificateKind: input.certificateKind,
        preferredOn: input.preferredOn,
        message: input.message,
      })
      .returning({ id: portalRequest.id });
    if (!row) throw new Error("createPortalRequest: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "portal_request.create",
      entityType: "reservation",
      entityId: input.reservationId,
      after: { kind: input.kind, certificateKind: input.certificateKind },
    });
    return { id: row.id };
  });
}

/** The buyer's requests on one of their sales, newest first (portal sale page). */
export async function listSalePortalRequests(ctx: PortalCtx, reservationId: string) {
  if (!isUuid(reservationId)) return [];
  return withTenant(ctx, async (tx) => {
    if (!(await isPortalSale(tx, ctx.userId, reservationId))) return [];
    return tx
      .select({
        id: portalRequest.id,
        kind: portalRequest.kind,
        certificateKind: portalRequest.certificateKind,
        preferredOn: portalRequest.preferredOn,
        message: portalRequest.message,
        status: portalRequest.status,
        answer: portalRequest.answer,
        createdAt: portalRequest.createdAt,
        handledAt: portalRequest.handledAt,
      })
      .from(portalRequest)
      .where(eq(portalRequest.reservationId, reservationId))
      .orderBy(desc(portalRequest.createdAt));
  });
}

/**
 * Staff close a request of a sale they see (`sale:read`): done, or declined with an answer the
 * buyer reads. Audited.
 */
export async function closePortalRequest(
  ctx: TenantCtx,
  input: In<typeof closePortalRequestSchema>,
) {
  assertCan(ctx, "sale:read");
  if (input.outcome === "declined" && !input.answer) {
    throw new AppError("VALIDATION", "requests.errors.answerRequired", {
      fieldErrors: { answer: ["requests.errors.answerRequired"] },
    });
  }
  await withTenant(ctx, async (tx) => {
    const [request] = await tx
      .select()
      .from(portalRequest)
      .where(eq(portalRequest.id, input.requestId))
      .for("update");
    if (!request) throw new AppError("NOT_FOUND");
    await loadVisibleReservation(tx, ctx, request.reservationId);
    if (request.status !== "open") throw new AppError("CONFLICT", "requests.errors.closed");
    await tx
      .update(portalRequest)
      .set({
        status: input.outcome,
        answer: input.answer,
        handledBy: ctx.userId,
        handledAt: new Date(),
      })
      .where(eq(portalRequest.id, request.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "portal_request.close",
      entityType: "reservation",
      entityId: request.reservationId,
      after: { kind: request.kind, outcome: input.outcome },
      reason: input.answer ?? undefined,
    });
  });
}

const handler = alias(user, "handler");
const mainBuyer = alias(reservationBuyer, "main_buyer");

/** Staff list of the requests of the sales they see, open ones first by default (oldest first). */
export async function listPortalRequests(ctx: TenantCtx, params: RequestListParams) {
  assertCan(ctx, "sale:read");
  return withTenant(ctx, async (tx) => {
    const where = and(
      params.status === "all" ? undefined : eq(portalRequest.status, params.status),
      visibleSales(ctx),
    );
    const rows = await tx
      .select({
        id: portalRequest.id,
        reservationId: portalRequest.reservationId,
        saleNumber: reservation.number,
        unitCode: unit.code,
        projectName: project.name,
        buyerName: sql<string>`${buyer.lastName} || ' ' || ${buyer.firstName}`,
        kind: portalRequest.kind,
        certificateKind: portalRequest.certificateKind,
        preferredOn: portalRequest.preferredOn,
        message: portalRequest.message,
        status: portalRequest.status,
        answer: portalRequest.answer,
        createdAt: portalRequest.createdAt,
        handledAt: portalRequest.handledAt,
        handlerName: handler.name,
      })
      .from(portalRequest)
      .innerJoin(reservation, eq(reservation.id, portalRequest.reservationId))
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .innerJoin(project, eq(project.id, reservation.projectId))
      .innerJoin(
        mainBuyer,
        and(eq(mainBuyer.reservationId, reservation.id), eq(mainBuyer.position, 1)),
      )
      .innerJoin(buyer, eq(buyer.id, mainBuyer.buyerId))
      .leftJoin(handler, eq(handler.id, portalRequest.handledBy))
      .where(where)
      .orderBy(
        params.status === "open" ? asc(portalRequest.createdAt) : desc(portalRequest.createdAt),
      )
      .limit(REQUESTS_PAGE_SIZE)
      .offset((params.page - 1) * REQUESTS_PAGE_SIZE);
    const [total] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(portalRequest)
      .innerJoin(reservation, eq(reservation.id, portalRequest.reservationId))
      .where(where);
    return { rows, total: total?.n ?? 0, page: params.page, pageSize: REQUESTS_PAGE_SIZE };
  });
}

export type PortalRequestRow = Awaited<ReturnType<typeof listPortalRequests>>["rows"][number];

/** Open requests of the sales a member sees (dashboard to-do). */
export async function countOpenPortalRequests(tx: Tx, ctx: TenantCtx) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(portalRequest)
    .innerJoin(reservation, eq(reservation.id, portalRequest.reservationId))
    .where(and(eq(portalRequest.status, "open"), visibleSales(ctx)));
  return row?.n ?? 0;
}
