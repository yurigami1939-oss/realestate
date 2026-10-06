import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { lead, partner, partnerCommission, reservation, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { applyRate } from "@/lib/money";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { resolvePaymentAccount } from "@/server/treasury/service";

import type {
  createPartnerSchema,
  payPartnerCommissionSchema,
  updatePartnerSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

const values = (input: In<typeof createPartnerSchema>) => {
  const { commissionRate, ...fields } = input;
  return { ...fields, commissionRateBp: commissionRate };
};

/** An agency or introducer (managers: `lead:assign`). Audited. */
export async function createPartner(ctx: TenantCtx, input: In<typeof createPartnerSchema>) {
  assertCan(ctx, "lead:assign");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(partner)
      .values({ ...values(input), organizationId: ctx.orgId })
      .returning({ id: partner.id });
    if (!row) throw new Error("createPartner: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "partner.create",
      entityType: "partner",
      entityId: row.id,
      after: { name: input.name, kind: input.kind, rateBp: input.commissionRate },
    });
    return { id: row.id };
  });
}

/** Corrects a partner; a new rate applies to sales signed afterwards. Audited. */
export async function updatePartner(ctx: TenantCtx, input: In<typeof updatePartnerSchema>) {
  assertCan(ctx, "lead:assign");
  const { partnerId, ...fields } = input;
  await withTenant(ctx, async (tx) => {
    const [before] = await tx
      .select({ name: partner.name, rateBp: partner.commissionRateBp })
      .from(partner)
      .where(and(eq(partner.id, partnerId), isNull(partner.deletedAt)))
      .for("update");
    if (!before) throw new AppError("NOT_FOUND");
    await tx
      .update(partner)
      .set({ ...values(fields), updatedAt: new Date() })
      .where(eq(partner.id, partnerId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "partner.update",
      entityType: "partner",
      entityId: partnerId,
      before,
      after: { name: fields.name, rateBp: fields.commissionRate },
    });
  });
}

/**
 * At the VSP (`recordSale`): the partner who brought the sale's lead earns its commission on
 * the net price at its current rate (none at 0 %). Same transaction as the VSP.
 */
export async function earnPartnerCommission(
  tx: Tx,
  ctx: TenantCtx,
  sale: { id: string; leadId: string | null; price: bigint },
  earnedOn: string,
) {
  if (!sale.leadId) return null;
  const [row] = await tx
    .select({ id: partner.id, rateBp: partner.commissionRateBp })
    .from(lead)
    .innerJoin(partner, eq(partner.id, lead.partnerId))
    .where(and(eq(lead.id, sale.leadId), isNull(partner.deletedAt)));
  if (!row || row.rateBp <= 0) return null;
  const amount = applyRate(sale.price, row.rateBp);
  if (amount <= 0n) return null;
  await tx.insert(partnerCommission).values({
    organizationId: ctx.orgId,
    reservationId: sale.id,
    partnerId: row.id,
    base: sale.price,
    rateBp: row.rateBp,
    amount,
    earnedOn,
  });
  return amount;
}

/** A sale undone (withdrawal, termination): its partner's earned commission is cancelled. */
export async function cancelPartnerCommission(
  tx: Tx,
  ctx: TenantCtx,
  reservationId: string,
  reason: string,
) {
  await tx
    .update(partnerCommission)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: ctx.userId,
      cancelReason: reason,
    })
    .where(
      and(
        eq(partnerCommission.reservationId, reservationId),
        eq(partnerCommission.status, "earned"),
      ),
    );
}

/**
 * Accountant (`commission:update`): an earned partner commission paid out, from a chosen
 * account else the method's default (it shows in the account's ledger). Audited.
 */
export async function payPartnerCommission(
  ctx: TenantCtx,
  input: In<typeof payPartnerCommissionSchema>,
) {
  assertCan(ctx, "commission:update");
  if (input.paidOn > todayInAlgiers()) throw invalid("paidOn", "sales.errors.futureDate");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(partnerCommission)
      .where(eq(partnerCommission.id, input.commissionId))
      .for("update");
    if (!row) throw new AppError("NOT_FOUND");
    if (row.status !== "earned") throw new AppError("CONFLICT", "commissions.errors.notEarned");
    if (input.paidOn < row.earnedOn) throw invalid("paidOn", "commissions.errors.beforeEarned");
    const accountId = await resolvePaymentAccount(tx, input.method, input.accountId);
    await tx
      .update(partnerCommission)
      .set({
        status: "paid",
        paidOn: input.paidOn,
        paymentMethod: input.method,
        accountId,
        paidBy: ctx.userId,
      })
      .where(eq(partnerCommission.id, row.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "partner.commission_pay",
      entityType: "partner",
      entityId: row.partnerId,
      after: { amount: row.amount, paidOn: input.paidOn, method: input.method, accountId },
    });
  });
}

/** Partners with their leads and commissions (managers or accountants). */
export async function listPartners(ctx: TenantCtx) {
  if (!can(ctx.roles, "lead:assign") && !can(ctx.roles, "commission:read_all")) {
    throw new AppError("FORBIDDEN");
  }
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({
        id: partner.id,
        kind: partner.kind,
        name: partner.name,
        contactName: partner.contactName,
        phone: partner.phone,
        email: partner.email,
        nif: partner.nif,
        rcNumber: partner.rcNumber,
        commissionRateBp: partner.commissionRateBp,
        notes: partner.notes,
        leads: sql<number>`(select count(*)::int from lead l where l.partner_id = partner.id and l.deleted_at is null)`,
        earned: sql<string>`(select coalesce(sum(c.amount), 0)::text from partner_commission c where c.partner_id = partner.id and c.status = 'earned')`,
        paid: sql<string>`(select coalesce(sum(c.amount), 0)::text from partner_commission c where c.partner_id = partner.id and c.status = 'paid')`,
      })
      .from(partner)
      .where(isNull(partner.deletedAt))
      .orderBy(asc(partner.name)),
  );
  return rows.map((r) => ({ ...r, earned: BigInt(r.earned), paid: BigInt(r.paid) }));
}

export type PartnerRow = Awaited<ReturnType<typeof listPartners>>[number];

/** Partners a lead can name (anyone who works leads). */
export async function listPartnerChoices(ctx: TenantCtx) {
  assertCan(ctx, "lead:read");
  return withTenant(ctx, (tx) =>
    tx
      .select({ id: partner.id, name: partner.name, kind: partner.kind })
      .from(partner)
      .where(isNull(partner.deletedAt))
      .orderBy(asc(partner.name)),
  );
}

/** Partner commissions, earned ones first (`commission:read_all`). */
export async function listPartnerCommissions(ctx: TenantCtx) {
  assertCan(ctx, "commission:read_all");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: partnerCommission.id,
        partnerName: partner.name,
        reservationId: partnerCommission.reservationId,
        saleNumber: reservation.number,
        unitCode: unit.code,
        base: partnerCommission.base,
        rateBp: partnerCommission.rateBp,
        amount: partnerCommission.amount,
        earnedOn: partnerCommission.earnedOn,
        status: partnerCommission.status,
        paidOn: partnerCommission.paidOn,
      })
      .from(partnerCommission)
      .innerJoin(partner, eq(partner.id, partnerCommission.partnerId))
      .innerJoin(reservation, eq(reservation.id, partnerCommission.reservationId))
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .orderBy(sql`${partnerCommission.status} = 'earned' desc`, desc(partnerCommission.earnedOn))
      .limit(200),
  );
}

export type PartnerCommissionRow = Awaited<ReturnType<typeof listPartnerCommissions>>[number];
