import "server-only";

import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  auditLog,
  budget,
  chargeCategory,
  chargePayment,
  chargePeriod,
  commission,
  constructionMilestone,
  generalAssembly,
  member,
  payment,
  priceList,
  staffMember,
  supplierInvoice,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, fromAlgiersDateTime } from "@/lib/dates";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { AUDIT_PAGE_SIZE, type AuditListParams } from "./schemas";

/** Instant at which an Algiers calendar day starts. */
const startOfDay = (day: string) => fromAlgiersDateTime(`${day}T00:00`);

/**
 * Page of the audit trail (CLAUDE.md §7), most recent first: who did what, on which record,
 * with the before/after snapshot and the reason. Gérant and comptable (`audit:read`).
 */
export async function listAuditLog(ctx: TenantCtx, params: AuditListParams) {
  assertCan(ctx, "audit:read");
  const page = params.page ?? 1;
  const from = params.from ? startOfDay(params.from) : null;
  const to = params.to ? startOfDay(addDays(params.to, 1)) : null;
  return withTenant(ctx, async (tx) => {
    const where = and(
      params.entityType ? eq(auditLog.entityType, params.entityType) : undefined,
      params.entityId ? eq(auditLog.entityId, params.entityId) : undefined,
      params.actorUserId ? eq(auditLog.actorUserId, params.actorUserId) : undefined,
      from ? gte(auditLog.createdAt, from) : undefined,
      to ? lt(auditLog.createdAt, to) : undefined,
    );
    const rows = await tx
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        actorUserId: auditLog.actorUserId,
        actorName: user.name,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        before: auditLog.before,
        after: auditLog.after,
        reason: auditLog.reason,
      })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorUserId))
      .where(where)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE);
    const [total] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(where);
    const hrefs = await recordLinks(tx, rows);
    return {
      rows: rows.map((r) => ({ ...r, href: hrefs.get(`${r.entityType}:${r.entityId}`) ?? null })),
      total: total?.n ?? 0,
      page,
      pageSize: AUDIT_PAGE_SIZE,
    };
  });
}

export type AuditRow = Awaited<ReturnType<typeof listAuditLog>>["rows"][number];

/**
 * Page of the record each entry is about, when it has one (`type:id` → path). Records that
 * hang off another one (a payment's sale, a unit's project…) are resolved in one query per type.
 */
async function recordLinks(
  tx: Tx,
  rows: { entityType: string; entityId: string }[],
): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const ids = (type: string) => [
    ...new Set(rows.filter((r) => r.entityType === type).map((r) => r.entityId)),
  ];
  for (const id of ids("reservation")) links.set(`reservation:${id}`, `/sales/${id}`);
  for (const id of ids("lead")) links.set(`lead:${id}`, `/leads/${id}`);
  for (const id of ids("quotation")) links.set(`quotation:${id}`, `/quotations/${id}`);
  for (const id of ids("organization")) links.set(`organization:${id}`, "/settings/company");
  for (const id of ids("residence")) links.set(`residence:${id}`, `/residences/${id}`);
  for (const type of ["member", "invitation"]) {
    for (const id of ids(type)) links.set(`${type}:${id}`, "/settings/members");
  }

  const unitIds = ids("unit");
  if (unitIds.length > 0) {
    const units = await tx
      .select({ id: unit.id, projectId: unit.projectId })
      .from(unit)
      .where(inArray(unit.id, unitIds));
    for (const u of units) links.set(`unit:${u.id}`, `/projects/${u.projectId}/units/${u.id}`);
  }
  const listIds = ids("price_list");
  if (listIds.length > 0) {
    const lists = await tx
      .select({ id: priceList.id, projectId: priceList.projectId })
      .from(priceList)
      .where(inArray(priceList.id, listIds));
    for (const l of lists) {
      links.set(`price_list:${l.id}`, `/projects/${l.projectId}/price-lists/${l.id}`);
    }
  }
  const milestoneIds = ids("construction_milestone");
  if (milestoneIds.length > 0) {
    const milestones = await tx
      .select({ id: constructionMilestone.id, projectId: constructionMilestone.projectId })
      .from(constructionMilestone)
      .where(inArray(constructionMilestone.id, milestoneIds));
    for (const m of milestones) {
      links.set(`construction_milestone:${m.id}`, `/projects/${m.projectId}/payment-plans`);
    }
  }
  const paymentIds = ids("payment");
  if (paymentIds.length > 0) {
    const payments = await tx
      .select({ id: payment.id, reservationId: payment.reservationId })
      .from(payment)
      .where(inArray(payment.id, paymentIds));
    for (const p of payments) links.set(`payment:${p.id}`, `/sales/${p.reservationId}`);
  }
  const commissionIds = ids("commission");
  if (commissionIds.length > 0) {
    const commissions = await tx
      .select({ id: commission.id, reservationId: commission.reservationId })
      .from(commission)
      .where(inArray(commission.id, commissionIds));
    for (const c of commissions) links.set(`commission:${c.id}`, `/sales/${c.reservationId}`);
  }
  const categoryIds = ids("charge_category");
  if (categoryIds.length > 0) {
    const categories = await tx
      .select({ id: chargeCategory.id, residenceId: chargeCategory.residenceId })
      .from(chargeCategory)
      .where(inArray(chargeCategory.id, categoryIds));
    for (const c of categories) {
      links.set(`charge_category:${c.id}`, `/residences/${c.residenceId}/charges`);
    }
  }
  const budgetIds = ids("budget");
  if (budgetIds.length > 0) {
    const budgets = await tx
      .select({ id: budget.id, residenceId: budget.residenceId, year: budget.year })
      .from(budget)
      .where(inArray(budget.id, budgetIds));
    for (const b of budgets) {
      links.set(`budget:${b.id}`, `/residences/${b.residenceId}/charges?year=${b.year}`);
    }
  }
  const periodIds = ids("charge_period");
  if (periodIds.length > 0) {
    const periods = await tx
      .select({ id: chargePeriod.id, residenceId: chargePeriod.residenceId })
      .from(chargePeriod)
      .where(inArray(chargePeriod.id, periodIds));
    for (const p of periods) {
      links.set(`charge_period:${p.id}`, `/residences/${p.residenceId}/calls/${p.id}`);
    }
  }
  const chargePaymentIds = ids("charge_payment");
  if (chargePaymentIds.length > 0) {
    const payments = await tx
      .select({
        id: chargePayment.id,
        residenceId: chargePayment.residenceId,
        unitId: chargePayment.unitId,
      })
      .from(chargePayment)
      .where(inArray(chargePayment.id, chargePaymentIds));
    for (const p of payments) {
      links.set(`charge_payment:${p.id}`, `/residences/${p.residenceId}/accounts/${p.unitId}`);
    }
  }
  const invoiceIds = ids("supplier_invoice");
  if (invoiceIds.length > 0) {
    const invoices = await tx
      .select({ id: supplierInvoice.id, residenceId: supplierInvoice.residenceId })
      .from(supplierInvoice)
      .where(inArray(supplierInvoice.id, invoiceIds));
    for (const i of invoices) {
      links.set(`supplier_invoice:${i.id}`, `/residences/${i.residenceId}/expenses`);
    }
  }
  const staffIds = ids("staff_member");
  if (staffIds.length > 0) {
    const agents = await tx
      .select({ id: staffMember.id, residenceId: staffMember.residenceId })
      .from(staffMember)
      .where(inArray(staffMember.id, staffIds));
    for (const a of agents) {
      links.set(`staff_member:${a.id}`, `/residences/${a.residenceId}/staff/${a.id}`);
    }
  }
  const assemblyIds = ids("general_assembly");
  if (assemblyIds.length > 0) {
    const assemblies = await tx
      .select({ id: generalAssembly.id, residenceId: generalAssembly.residenceId })
      .from(generalAssembly)
      .where(inArray(generalAssembly.id, assemblyIds));
    for (const a of assemblies) {
      links.set(`general_assembly:${a.id}`, `/residences/${a.residenceId}/assemblies/${a.id}`);
    }
  }
  return links;
}

/** Members of the organization, for the actor filter. */
export async function listAuditActors(ctx: TenantCtx) {
  assertCan(ctx, "audit:read");
  return withTenant(ctx, (tx) =>
    // `member` is scoped by Better Auth, not RLS: filter on the organization explicitly.
    tx
      .select({ userId: member.userId, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, ctx.orgId))
      .orderBy(user.name),
  );
}
