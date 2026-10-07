import "server-only";

import { and, count, desc, eq, ilike, inArray, isNotNull, or, type SQL, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  chargePayment,
  lease,
  onlinePayment,
  organization,
  paymentGateway,
  project,
  receipt,
  rentPayment,
  reservation,
  residence,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import type { PortalCtx } from "@/server/portal/context";

import { satimBaseUrl, satimStandInUrl } from "./gateway";
import type { OnlinePaymentListParams } from "./schemas";

export const ONLINE_PAYMENTS_PAGE_SIZE = 50;

/** The SATIM settings page (gérant): everything but the password, which is never sent back. */
export async function getGatewaySettings(ctx: TenantCtx) {
  assertCan(ctx, "organization:update");
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({
        enabled: paymentGateway.enabled,
        environment: paymentGateway.environment,
        username: paymentGateway.username,
        terminalId: paymentGateway.terminalId,
        salesEnabled: paymentGateway.salesEnabled,
        chargesEnabled: paymentGateway.chargesEnabled,
        rentEnabled: paymentGateway.rentEnabled,
        updatedAt: paymentGateway.updatedAt,
      })
      .from(paymentGateway)
      .where(eq(paymentGateway.organizationId, ctx.orgId)),
  );
  return { settings: row ?? null, testIsStandIn: satimBaseUrl("test") === satimStandInUrl() };
}

/** What the portal offers to pay online (null when the gateway is off). */
export async function portalPaymentOptions(tx: Tx, orgId: string) {
  const [row] = await tx
    .select({
      enabled: paymentGateway.enabled,
      environment: paymentGateway.environment,
      sale: paymentGateway.salesEnabled,
      charges: paymentGateway.chargesEnabled,
      rent: paymentGateway.rentEnabled,
    })
    .from(paymentGateway)
    .where(eq(paymentGateway.organizationId, orgId));
  return row?.enabled ? row : null;
}

export type PortalPaymentOptions = NonNullable<Awaited<ReturnType<typeof portalPaymentOptions>>>;

/** Columns shared by the staff list and the portal: the payment and what it paid. */
const columns = {
  id: onlinePayment.id,
  purpose: onlinePayment.purpose,
  status: onlinePayment.status,
  amount: onlinePayment.amount,
  orderNumber: onlinePayment.orderNumber,
  environment: onlinePayment.environment,
  gatewayOrderId: onlinePayment.gatewayOrderId,
  gatewayMessage: onlinePayment.gatewayMessage,
  approvalCode: onlinePayment.approvalCode,
  cardPan: onlinePayment.cardPan,
  payerName: onlinePayment.payerName,
  createdAt: onlinePayment.createdAt,
  paidAt: onlinePayment.paidAt,
  issue: onlinePayment.issue,
  refundedAt: onlinePayment.refundedAt,
  refundReason: onlinePayment.refundReason,
  reservationId: onlinePayment.reservationId,
  residenceId: onlinePayment.residenceId,
  unitId: onlinePayment.unitId,
  leaseId: onlinePayment.leaseId,
  saleNumber: reservation.number,
  leaseNumber: lease.number,
  projectName: project.name,
  residenceName: residence.name,
  unitCode: unit.code,
  receiptNumber: receipt.number,
  receiptFileId: receipt.pdfFileId,
  chargeReceiptNumber: chargePayment.receiptNumber,
  chargeReceiptFileId: chargePayment.pdfFileId,
  rentReceiptNumber: rentPayment.receiptNumber,
  rentReceiptFileId: rentPayment.pdfFileId,
};

/** The query with what each payment paid joined (sale, residence or lease, unit, receipt). */
function selectPayments(tx: Tx) {
  return tx
    .select(columns)
    .from(onlinePayment)
    .leftJoin(reservation, eq(reservation.id, onlinePayment.reservationId))
    .leftJoin(lease, eq(lease.id, onlinePayment.leaseId))
    .leftJoin(project, or(eq(project.id, reservation.projectId), eq(project.id, lease.projectId)))
    .leftJoin(residence, eq(residence.id, onlinePayment.residenceId))
    .leftJoin(
      unit,
      or(
        eq(unit.id, reservation.unitId),
        eq(unit.id, lease.unitId),
        and(eq(onlinePayment.purpose, "charges"), eq(unit.id, onlinePayment.unitId)),
      ),
    )
    .leftJoin(receipt, eq(receipt.paymentId, onlinePayment.paymentId))
    .leftJoin(chargePayment, eq(chargePayment.id, onlinePayment.chargePaymentId))
    .leftJoin(rentPayment, eq(rentPayment.id, onlinePayment.rentPaymentId));
}

/**
 * Rows the member may see: sales ones with `sale:read_all`, charges ones with `charge:read`,
 * rents with `lease:read`.
 */
function visibleTo(ctx: TenantCtx): SQL | undefined {
  const seen = (
    [
      ["sale", "sale:read_all"],
      ["charges", "charge:read"],
      ["rent", "lease:read"],
    ] as const
  ).flatMap(([purpose, permission]) => (can(ctx.roles, permission) ? [purpose] : []));
  if (seen.length === 3) return undefined;
  if (seen.length === 0) return sql`false`;
  return inArray(onlinePayment.purpose, seen);
}

/** Staff list (`payment:read`), latest first, with the ones paid but not recorded on demand. */
export async function listOnlinePayments(ctx: TenantCtx, params: OnlinePaymentListParams) {
  assertCan(ctx, "payment:read");
  const page = params.page ?? 1;
  const q = params.q ? `%${params.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const where = and(
    visibleTo(ctx),
    params.status ? eq(onlinePayment.status, params.status) : undefined,
    params.issues
      ? and(eq(onlinePayment.status, "paid"), isNotNull(onlinePayment.issue))
      : undefined,
    q ? or(ilike(onlinePayment.orderNumber, q), ilike(onlinePayment.payerName, q)) : undefined,
  );
  return withTenant(ctx, async (tx) => {
    const rows = await selectPayments(tx)
      .where(where)
      .orderBy(desc(onlinePayment.createdAt))
      .limit(ONLINE_PAYMENTS_PAGE_SIZE)
      .offset((page - 1) * ONLINE_PAYMENTS_PAGE_SIZE);
    const [total] = await tx.select({ n: count() }).from(onlinePayment).where(where);
    const [issues] = await tx
      .select({ n: count() })
      .from(onlinePayment)
      .where(and(visibleTo(ctx), eq(onlinePayment.status, "paid"), isNotNull(onlinePayment.issue)));
    return { rows, total: total?.n ?? 0, issues: issues?.n ?? 0, page };
  });
}

/** Paid online but not recorded, for the dashboard (refund or settle by hand). */
export async function countOnlinePaymentIssues(tx: Tx, ctx: TenantCtx) {
  const [row] = await tx
    .select({ n: count() })
    .from(onlinePayment)
    .where(and(visibleTo(ctx), eq(onlinePayment.status, "paid"), isNotNull(onlinePayment.issue)));
  return row?.n ?? 0;
}

/** One online payment of the portal account (its result page); null otherwise. */
export async function getPortalOnlinePayment(ctx: PortalCtx, onlinePaymentId: string) {
  if (!isUuid(onlinePaymentId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await selectPayments(tx).where(
      and(eq(onlinePayment.id, onlinePaymentId), eq(onlinePayment.userId, ctx.userId)),
    );
    return row ?? null;
  });
}

/** The portal account's online payments, latest first. */
export async function listPortalOnlinePayments(ctx: PortalCtx) {
  return withTenant(ctx, (tx) =>
    selectPayments(tx)
      .where(eq(onlinePayment.userId, ctx.userId))
      .orderBy(desc(onlinePayment.createdAt))
      .limit(100),
  );
}

export type OnlinePaymentView = Awaited<ReturnType<typeof listPortalOnlinePayments>>[number];

/** What the portal account's organization lets it pay online (null when it is off). */
export async function getPortalPaymentOptions(ctx: PortalCtx) {
  return withTenant(ctx, (tx) => portalPaymentOptions(tx, ctx.orgId));
}

/** Name and phone of the promoter, for the payment conditions. */
export async function getPortalCompany(ctx: PortalCtx) {
  return withTenant(ctx, async (tx) => {
    // `organization` is Better Auth's table (no RLS): filter on the session's organization.
    const [row] = await tx
      .select({
        name: organization.name,
        legalName: organization.legalName,
        phone: organization.phone,
      })
      .from(organization)
      .where(eq(organization.id, ctx.orgId));
    return { name: row?.legalName ?? row?.name ?? "", phone: row?.phone ?? null };
  });
}
