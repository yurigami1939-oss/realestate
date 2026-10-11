import "server-only";

import { and, asc, desc, eq, inArray, lte, ne } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  lease,
  managementMandate,
  ownerStatement,
  ownerStatementItem,
  rentPayment,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { addDays, type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { ownerStatementTotals, type StatementPayment } from "@/lib/mandates";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";
import { resolvePaymentAccount } from "@/server/treasury/service";

import type {
  cancelOwnerStatementSchema,
  issueOwnerStatementSchema,
  payOwnerStatementSchema,
} from "./schemas";
import { loadOwner, OWNER_ENTITY } from "./service";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/**
 * What an owner's next statement reports (CLAUDE.md §7 Rentals): the valid rents collected on
 * the leases of its mandates up to `periodTo` and not reported yet, and the rents reported on
 * an earlier statement and cancelled since (a bounced cheque), as reversals. Deposits stay with
 * the organization (they are refunded to the tenant).
 */
export async function pendingStatementPayments(
  tx: Tx,
  ownerId: string,
  periodTo: CalendarDate,
): Promise<StatementPayment[]> {
  const rows = await tx
    .select({
      rentPaymentId: rentPayment.id,
      status: rentPayment.status,
      leaseNumber: lease.number,
      tenantName: lease.tenantName,
      unitCode: unit.code,
      receiptNumber: rentPayment.receiptNumber,
      paidOn: rentPayment.paidOn,
      amount: rentPayment.amount,
      feeRateBp: managementMandate.feeRateBp,
    })
    .from(rentPayment)
    .innerJoin(lease, eq(lease.id, rentPayment.leaseId))
    .innerJoin(managementMandate, eq(managementMandate.id, lease.mandateId))
    .innerJoin(unit, eq(unit.id, lease.unitId))
    .where(
      and(
        eq(managementMandate.ownerId, ownerId),
        eq(rentPayment.kind, "rent"),
        lte(rentPayment.paidOn, periodTo),
      ),
    )
    .orderBy(asc(rentPayment.paidOn), asc(rentPayment.receiptNumber));
  // What live statements already reported or reversed (a cancelled one's items are deleted).
  const items =
    rows.length === 0
      ? []
      : await tx
          .select({
            rentPaymentId: ownerStatementItem.rentPaymentId,
            reversal: ownerStatementItem.reversal,
          })
          .from(ownerStatementItem)
          .where(
            inArray(
              ownerStatementItem.rentPaymentId,
              rows.map((r) => r.rentPaymentId),
            ),
          );
  const reported = new Set(items.filter((i) => !i.reversal).map((i) => i.rentPaymentId));
  const reversed = new Set(items.filter((i) => i.reversal).map((i) => i.rentPaymentId));
  return rows.flatMap(({ status, ...row }): StatementPayment[] => {
    const id = row.rentPaymentId;
    if (status === "valid" && !reported.has(id)) return [{ ...row, reversal: false }];
    if (status === "cancelled" && reported.has(id) && !reversed.has(id)) {
      return [{ ...row, reversal: true }];
    }
    return [];
  });
}

/**
 * Issues an owner statement (`RDG-`, `lease:update`) up to a day not in the future: the pending
 * rents with the fee at each mandate's rate, other deductions typed (repairs paid for the
 * owner…), the net to pay out — never negative. Lines frozen; its PDF rendered by the worker.
 * Audited on the owner.
 */
export async function issueOwnerStatement(
  ctx: TenantCtx,
  input: In<typeof issueOwnerStatementSchema>,
) {
  assertCan(ctx, "lease:update");
  const today = todayInAlgiers();
  if (input.periodTo > today) throw invalid("periodTo", "rentals.errors.futureDate");
  return withTenant(ctx, async (tx) => {
    const owner = await loadOwner(tx, input.ownerId);
    const payments = await pendingStatementPayments(tx, owner.id, input.periodTo);
    if (payments.length === 0) throw new AppError("CONFLICT", "mandates.errors.nothingToReport");
    const totals = ownerStatementTotals(payments, input.extras);
    if (totals.net < 0n) throw invalid("extras", "mandates.errors.negativeNet");
    const [previous] = await tx
      .select({ periodTo: ownerStatement.periodTo })
      .from(ownerStatement)
      .where(and(eq(ownerStatement.ownerId, owner.id), ne(ownerStatement.status, "cancelled")))
      .orderBy(desc(ownerStatement.periodTo))
      .limit(1);
    const firstPaid = payments.reduce((min, p) => (p.paidOn < min ? p.paidOn : min), today);
    const periodFrom = previous ? addDays(previous.periodTo, 1) : firstPaid;
    const { number } = await nextDocumentNumber(tx, ctx, "owner_statement");
    const [row] = await tx
      .insert(ownerStatement)
      .values({
        organizationId: ctx.orgId,
        number,
        ownerId: owner.id,
        periodFrom: periodFrom <= input.periodTo ? periodFrom : null,
        periodTo: input.periodTo,
        issuedOn: today,
        collected: totals.collected,
        fees: totals.fees,
        deductions: totals.deductions,
        net: totals.net,
        lines: totals.lines.map((l) => ({
          leaseNumber: l.leaseNumber,
          tenantName: l.tenantName,
          unitCode: l.unitCode,
          receiptNumber: l.receiptNumber,
          paidOn: l.paidOn,
          amount: l.amount.toString(),
          feeRateBp: l.feeRateBp,
          fee: l.fee.toString(),
          reversal: l.reversal,
        })),
        extras: input.extras.map((e) => ({ label: e.label, amount: e.amount.toString() })),
        createdBy: ctx.userId,
      })
      .returning({ id: ownerStatement.id });
    if (!row) throw new Error("issueOwnerStatement: no row returned");
    await tx.insert(ownerStatementItem).values(
      payments.map((p) => ({
        organizationId: ctx.orgId,
        statementId: row.id,
        rentPaymentId: p.rentPaymentId,
        reversal: p.reversal,
      })),
    );
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "owner_statement", id: row.id },
      { singletonKey: row.id },
    );
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "owner_statement.issue",
      entityType: OWNER_ENTITY,
      entityId: owner.id,
      after: {
        number,
        periodTo: input.periodTo,
        collected: totals.collected,
        fees: totals.fees,
        deductions: totals.deductions,
        net: totals.net,
      },
    });
    return { id: row.id, number };
  });
}

async function loadStatement(tx: Tx, statementId: string) {
  const [row] = await tx
    .select()
    .from(ownerStatement)
    .where(eq(ownerStatement.id, statementId))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/**
 * Pays a statement's net out to its owner (`lease:update`) from a cash desk or an account (« Payé
 * depuis », else the method's default), on a day from its issue to today: an outflow of that
 * account's ledger. Audited on the owner.
 */
export async function payOwnerStatement(ctx: TenantCtx, input: In<typeof payOwnerStatementSchema>) {
  assertCan(ctx, "lease:update");
  if (input.paidOn > todayInAlgiers()) throw invalid("paidOn", "rentals.errors.futureDate");
  await withTenant(ctx, async (tx) => {
    const current = await loadStatement(tx, input.statementId);
    if (current.status !== "issued") throw new AppError("CONFLICT", "mandates.errors.notIssued");
    if (input.paidOn < current.issuedOn) throw invalid("paidOn", "mandates.errors.paidBeforeIssue");
    const accountId = await resolvePaymentAccount(tx, input.method, input.accountId);
    await tx
      .update(ownerStatement)
      .set({
        status: "paid",
        paidOn: input.paidOn,
        paymentMethod: input.method,
        paymentReference: input.reference,
        accountId,
        paidBy: ctx.userId,
      })
      .where(eq(ownerStatement.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "owner_statement.pay",
      entityType: OWNER_ENTITY,
      entityId: current.ownerId,
      after: { number: current.number, net: current.net, ...input, accountId },
    });
  });
}

/**
 * Cancels an unpaid statement with a reason: its rents are reported again on the next one.
 * Audited on the owner.
 */
export async function cancelOwnerStatement(
  ctx: TenantCtx,
  input: In<typeof cancelOwnerStatementSchema>,
) {
  assertCan(ctx, "lease:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadStatement(tx, input.statementId);
    if (current.status !== "issued") throw new AppError("CONFLICT", "mandates.errors.notIssued");
    await tx
      .update(ownerStatement)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationReason: input.reason,
        cancelledBy: ctx.userId,
      })
      .where(eq(ownerStatement.id, current.id));
    await tx.delete(ownerStatementItem).where(eq(ownerStatementItem.statementId, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "owner_statement.cancel",
      entityType: OWNER_ENTITY,
      entityId: current.ownerId,
      before: { number: current.number, status: "issued" },
      after: { status: "cancelled" },
      reason: input.reason,
    });
  });
}

/** The statement of an owner whose PDF is missing: queued again (idempotent renderer). */
export async function requestOwnerStatementPdf(ctx: TenantCtx, statementId: string) {
  assertCan(ctx, "lease:read");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ id: ownerStatement.id, pdfFileId: ownerStatement.pdfFileId })
      .from(ownerStatement)
      .where(eq(ownerStatement.id, statementId));
    if (!row) throw new AppError("NOT_FOUND");
    if (row.pdfFileId) return;
    await enqueueInTx(tx, "pdf.document", {
      organizationId: ctx.orgId,
      kind: "owner_statement",
      id: row.id,
    });
  });
}
