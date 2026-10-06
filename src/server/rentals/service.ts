import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { lease, leaseInspection, rentPayment, resident, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { leaseEndOn } from "@/lib/rentals";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { resolvePaymentAccount } from "@/server/treasury/service";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { checkUpload, discardFile, storeFile, type Upload } from "@/server/files/service";
import { transitionUnit } from "@/server/inventory/transition-unit";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";
import { addLeaseOccupant, endLeaseOccupant } from "@/server/residences/service";
import { notifyRentPayment } from "@/server/whatsapp/notify";

import { leasePaid, rentStatement } from "./accounts";
import type {
  cancelRentPaymentSchema,
  clearRentChequeSchema,
  createLeaseSchema,
  endLeaseSchema,
  recordInspectionSchema,
  recordRentPaymentSchema,
  renewLeaseSchema,
  settleDepositSchema,
  updateLeaseSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Entity type of the stored lease documents: quittances, contract scan (`file.entity_type`). */
export const LEASE_ENTITY = "lease";

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

function assertNotFuture(day: string, field: string) {
  if (day > todayInAlgiers()) throw invalid(field, "rentals.errors.futureDate");
}

/** A lease of the organization (locked: its payments and changes are serialized). */
async function loadLease(tx: Tx, leaseId: string) {
  const [row] = await tx.select().from(lease).where(eq(lease.id, leaseId)).for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

function assertActive(row: { status: string }) {
  if (row.status !== "active") throw new AppError("CONFLICT", "rentals.errors.ended");
}

type TermsInput = Pick<
  In<typeof createLeaseSchema>,
  | "signedOn"
  | "startOn"
  | "durationMonths"
  | "monthlyRent"
  | "monthlyCharges"
  | "frequency"
  | "deposit"
>;

/** Stored terms: the term's last day is derived, empty amounts are zero. */
const termsValues = (input: TermsInput) => ({
  signedOn: input.signedOn,
  startOn: input.startOn,
  durationMonths: input.durationMonths,
  endOn: leaseEndOn(input.startOn, input.durationMonths),
  monthlyRent: input.monthlyRent,
  monthlyCharges: input.monthlyCharges ?? 0n,
  frequency: input.frequency,
  deposit: input.deposit ?? 0n,
});

const tenantValues = (input: In<typeof createLeaseSchema> | In<typeof updateLeaseSchema>) => ({
  kind: input.kind,
  tenantName: input.tenantName,
  tenantNameAr: input.tenantNameAr,
  tenantIdNumber: input.tenantIdNumber,
  tenantPhone: input.tenantPhone,
  tenantWhatsappOptIn: input.tenantWhatsappOptIn,
  tenantEmail: input.tenantEmail,
  tenantAddress: input.tenantAddress,
  activity: input.activity,
  notes: input.notes,
});

/**
 * Leases a unit the promoter keeps (CLAUDE.md §7 Rentals): an `available` or `blocked` unit,
 * numbered BAL-…, becomes `rented`; in a residence, the tenant becomes the unit's occupant
 * from the start. Audited.
 */
export async function createLease(ctx: TenantCtx, input: In<typeof createLeaseSchema>) {
  assertCan(ctx, "lease:update");
  assertNotFuture(input.signedOn, "signedOn");
  return withTenant(ctx, async (tx) => {
    const [target] = await tx
      .select({ id: unit.id, code: unit.code, status: unit.status, projectId: unit.projectId })
      .from(unit)
      .where(and(eq(unit.id, input.unitId), isNull(unit.deletedAt)))
      .for("update");
    if (!target) throw invalid("unitId", "rentals.errors.unitNotFound");
    if (target.status !== "available" && target.status !== "blocked") {
      throw invalid("unitId", "rentals.errors.unitNotFree");
    }
    const { number } = await nextDocumentNumber(tx, ctx, "lease");
    const terms = termsValues(input);
    const [row] = await tx
      .insert(lease)
      .values({
        ...tenantValues(input),
        ...terms,
        organizationId: ctx.orgId,
        number,
        unitId: target.id,
        projectId: target.projectId,
        createdBy: ctx.userId,
      })
      .returning({ id: lease.id });
    if (!row) throw new Error("createLease: no row returned");
    await transitionUnit(tx, ctx, target.id, "rented", { refType: "lease", refId: row.id });
    const occupantId = await addLeaseOccupant(tx, ctx, {
      unitId: target.id,
      name: input.tenantName,
      phone: input.tenantPhone,
      whatsappOptIn: input.tenantWhatsappOptIn,
      email: input.tenantEmail,
      sinceOn: input.startOn,
    });
    if (occupantId) await tx.update(lease).set({ occupantId }).where(eq(lease.id, row.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "lease.create",
      entityType: "lease",
      entityId: row.id,
      after: { number, unit: target.code, tenant: input.tenantName, kind: input.kind, ...terms },
    });
    return { id: row.id, number };
  });
}

/**
 * Corrects an active lease: the tenant's details at any time, the terms only while no payment
 * is recorded (a renewal keeps its start, the day after the lease it renews). Audited.
 */
export async function updateLease(ctx: TenantCtx, input: In<typeof updateLeaseSchema>) {
  assertCan(ctx, "lease:update");
  assertNotFuture(input.signedOn, "signedOn");
  await withTenant(ctx, async (tx) => {
    const before = await loadLease(tx, input.leaseId);
    assertActive(before);
    const terms = termsValues(input);
    const changed = (Object.keys(terms) as (keyof typeof terms)[]).some(
      (key) => terms[key] !== before[key],
    );
    if (changed) {
      const paid = (await leasePaid(tx, [before.id])).get(before.id);
      if (paid && paid.rent + paid.deposit > 0n) {
        throw new AppError("CONFLICT", "rentals.errors.termsLocked");
      }
      if (before.renewedFromId && terms.startOn !== before.startOn) {
        throw invalid("startOn", "rentals.errors.renewalStart");
      }
    }
    const after = { ...tenantValues(input), ...terms };
    await tx.update(lease).set(after).where(eq(lease.id, before.id));
    if (before.occupantId) {
      await tx
        .update(resident)
        .set({
          lastName: input.tenantName,
          phone: input.tenantPhone,
          whatsappOptIn: input.tenantWhatsappOptIn,
          email: input.tenantEmail,
          ...(before.renewedFromId ? {} : { sinceOn: input.startOn }),
        })
        .where(eq(resident.id, before.occupantId));
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "lease.update",
      entityType: "lease",
      entityId: before.id,
      before,
      after,
    });
  });
}

/**
 * The tenant leaves, or the lease is cancelled (from its signature on, never in the future):
 * the unit is available again, the occupancy ends, the periods not started are no longer due.
 * Audited.
 */
export async function endLease(ctx: TenantCtx, input: In<typeof endLeaseSchema>) {
  assertCan(ctx, "lease:update");
  assertNotFuture(input.endedOn, "endedOn");
  await withTenant(ctx, async (tx) => {
    const current = await loadLease(tx, input.leaseId);
    assertActive(current);
    if (input.endedOn < current.signedOn) {
      throw invalid("endedOn", "rentals.errors.beforeSigning");
    }
    await tx
      .update(lease)
      .set({
        status: "ended",
        endedOn: input.endedOn,
        endReason: input.reason,
        endedBy: ctx.userId,
      })
      .where(eq(lease.id, current.id));
    await transitionUnit(tx, ctx, current.unitId, "available", {
      reason: input.reason,
      refType: "lease",
      refId: current.id,
    });
    if (current.occupantId) {
      await endLeaseOccupant(tx, ctx, current.occupantId, input.endedOn);
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "lease.end",
      entityType: "lease",
      entityId: current.id,
      before: { status: "active" },
      after: { status: "ended", endedOn: input.endedOn },
      reason: input.reason,
    });
  });
}

/**
 * Renews an active lease (CLAUDE.md §12): a new lease BAL-… for the same tenant and unit from
 * the day after the current term, with its own terms; the current one ends on its last day and
 * the deposit it holds is carried over. The unit stays rented. Audited.
 */
export async function renewLease(ctx: TenantCtx, input: In<typeof renewLeaseSchema>) {
  assertCan(ctx, "lease:update");
  assertNotFuture(input.signedOn, "signedOn");
  return withTenant(ctx, async (tx) => {
    const current = await loadLease(tx, input.leaseId);
    assertActive(current);
    const paid = (await leasePaid(tx, [current.id])).get(current.id) ?? { rent: 0n, deposit: 0n };
    const startOn = addDays(current.endOn, 1);
    const { number } = await nextDocumentNumber(tx, ctx, "lease");
    // The renewal's number is the end reason: the lease page links both.
    await tx
      .update(lease)
      .set({ status: "ended", endedOn: current.endOn, endReason: number, endedBy: ctx.userId })
      .where(eq(lease.id, current.id));
    const terms = termsValues({ ...input, startOn });
    const [row] = await tx
      .insert(lease)
      .values({
        organizationId: ctx.orgId,
        number,
        unitId: current.unitId,
        projectId: current.projectId,
        kind: current.kind,
        tenantName: current.tenantName,
        tenantNameAr: current.tenantNameAr,
        tenantIdNumber: current.tenantIdNumber,
        tenantPhone: current.tenantPhone,
        tenantWhatsappOptIn: current.tenantWhatsappOptIn,
        tenantEmail: current.tenantEmail,
        tenantAddress: current.tenantAddress,
        activity: current.activity,
        ...terms,
        depositCarried: current.depositCarried + paid.deposit,
        renewedFromId: current.id,
        occupantId: current.occupantId,
        notes: input.notes,
        createdBy: ctx.userId,
      })
      .returning({ id: lease.id });
    if (!row) throw new Error("renewLease: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "lease.renew",
      entityType: "lease",
      entityId: row.id,
      after: { number, renews: current.number, ...terms },
    });
    return { id: row.id, number };
  });
}

/**
 * Records a rent or deposit payment and issues its receipt QIT-… in the same transaction
 * (CLAUDE.md §7 Rentals): rent is applied to the oldest periods first and never above what
 * remains on the schedule; a deposit never above what is still missing of it. Audited; the
 * quittance PDF is rendered by the worker.
 */
export async function recordRentPayment(ctx: TenantCtx, input: In<typeof recordRentPaymentSchema>) {
  assertCan(ctx, "payment:create");
  assertNotFuture(input.paidOn, "paidOn");
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const current = await loadLease(tx, input.leaseId);
    const paid = (await leasePaid(tx, [current.id])).get(current.id) ?? { rent: 0n, deposit: 0n };
    let allocation: { fromOn: string; toOn: string; amount: string }[] = [];
    if (input.kind === "rent") {
      const before = rentStatement(current, paid.rent, today);
      if (input.amount > before.remaining) throw invalid("amount", "rentals.errors.aboveRemaining");
      const after = rentStatement(current, paid.rent + input.amount, today);
      allocation = after.lines.flatMap((line) => {
        const settled =
          line.paid - (before.lines.find((l) => l.position === line.position)?.paid ?? 0n);
        return settled > 0n
          ? [{ fromOn: line.fromOn, toOn: line.toOn, amount: settled.toString() }]
          : [];
      });
    } else {
      assertActive(current);
      const missing = current.deposit - current.depositCarried - paid.deposit;
      if (input.amount > missing) throw invalid("amount", "rentals.errors.aboveDeposit");
    }

    const { number } = await nextDocumentNumber(tx, ctx, "rent_receipt");
    const [row] = await tx
      .insert(rentPayment)
      .values({
        organizationId: ctx.orgId,
        leaseId: current.id,
        kind: input.kind,
        amount: input.amount,
        method: input.method,
        paidOn: input.paidOn,
        reference: input.reference,
        bank: input.bank,
        payerName: input.payerName,
        notes: input.notes,
        receiptNumber: number,
        allocation,
        accountId: await resolvePaymentAccount(tx, input.method, input.accountId),
        recordedBy: ctx.userId,
      })
      .returning({ id: rentPayment.id });
    if (!row) throw new Error("recordRentPayment: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "rent_payment.create",
      entityType: "lease",
      entityId: current.id,
      after: {
        lease: current.number,
        receipt: number,
        kind: input.kind,
        amount: input.amount,
        method: input.method,
        paidOn: input.paidOn,
        allocation,
      },
    });
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "rent_receipt", id: row.id },
      { singletonKey: `rent_receipt:${row.id}` },
    );
    await notifyRentPayment(tx, ctx, current.id, { amount: input.amount, receiptNumber: number });
    return { paymentId: row.id, receiptNumber: number };
  });
}

/**
 * Cancels a rent or deposit payment and its receipt with a reason (accountants; e.g. a bounced
 * cheque). Never deleted; what it settled is due again (derived). Audited.
 */
export async function cancelRentPayment(ctx: TenantCtx, input: In<typeof cancelRentPaymentSchema>) {
  assertCan(ctx, "payment:cancel");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({
        leaseId: rentPayment.leaseId,
        kind: rentPayment.kind,
        status: rentPayment.status,
        amount: rentPayment.amount,
        receiptNumber: rentPayment.receiptNumber,
      })
      .from(rentPayment)
      .where(eq(rentPayment.id, input.paymentId))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND");
    if (current.status === "cancelled") {
      throw new AppError("CONFLICT", "payments.errors.alreadyCancelled");
    }
    const owner = await loadLease(tx, current.leaseId);
    if (current.kind === "deposit" && owner.depositSettledOn) {
      throw new AppError("CONFLICT", "rentals.errors.depositSettled");
    }
    await tx
      .update(rentPayment)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: ctx.userId,
        cancellationReason: input.reason,
      })
      .where(eq(rentPayment.id, input.paymentId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "rent_payment.cancel",
      entityType: "lease",
      entityId: current.leaseId,
      before: { status: "valid", amount: current.amount, receipt: current.receiptNumber },
      after: { status: "cancelled" },
      reason: input.reason,
    });
  });
}

/** Records the day the bank cleared a cheque (its receipt was « sous réserve »). Audited. */
export async function clearRentCheque(ctx: TenantCtx, input: In<typeof clearRentChequeSchema>) {
  assertCan(ctx, "payment:create");
  assertNotFuture(input.clearedOn, "clearedOn");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({
        leaseId: rentPayment.leaseId,
        method: rentPayment.method,
        status: rentPayment.status,
        paidOn: rentPayment.paidOn,
        clearedOn: rentPayment.chequeClearedOn,
      })
      .from(rentPayment)
      .where(eq(rentPayment.id, input.paymentId))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND");
    if (current.method !== "cheque" || current.status !== "valid" || current.clearedOn) {
      throw new AppError("CONFLICT", "payments.errors.notPendingCheque");
    }
    if (input.clearedOn < current.paidOn) {
      throw invalid("clearedOn", "payments.errors.beforePayment");
    }
    await tx
      .update(rentPayment)
      .set({ chequeClearedOn: input.clearedOn })
      .where(eq(rentPayment.id, input.paymentId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "rent_payment.cheque_cleared",
      entityType: "lease",
      entityId: current.leaseId,
      after: { clearedOn: input.clearedOn },
    });
  });
}

/**
 * Settles the deposit of a lease that ended without renewal: what is given back and what is
 * kept (with the reason) add up to what was held. Final; audited.
 */
export async function settleDeposit(ctx: TenantCtx, input: In<typeof settleDepositSchema>) {
  assertCan(ctx, "lease:update");
  assertNotFuture(input.settledOn, "settledOn");
  await withTenant(ctx, async (tx) => {
    const current = await loadLease(tx, input.leaseId);
    if (current.status !== "ended" || !current.endedOn) {
      throw new AppError("CONFLICT", "rentals.errors.notEnded");
    }
    if (current.depositSettledOn) throw new AppError("CONFLICT", "rentals.errors.depositSettled");
    const [renewal] = await tx
      .select({ id: lease.id })
      .from(lease)
      .where(eq(lease.renewedFromId, current.id));
    if (renewal) throw new AppError("CONFLICT", "rentals.errors.depositCarried");
    const paid = (await leasePaid(tx, [current.id])).get(current.id) ?? { rent: 0n, deposit: 0n };
    const held = current.depositCarried + paid.deposit;
    if (held === 0n) throw new AppError("CONFLICT", "rentals.errors.noDeposit");
    const refunded = input.refunded ?? 0n;
    if (refunded > held) throw invalid("refunded", "rentals.errors.aboveHeld");
    const retained = held - refunded;
    if (retained > 0n && !input.reason) throw invalid("reason", "rentals.errors.retentionReason");
    if (input.settledOn < current.endedOn) {
      throw invalid("settledOn", "rentals.errors.beforeEnd");
    }
    // The refund leaves a cash desk or an account (CLAUDE.md §7 Treasury).
    const accountId =
      refunded > 0n ? await resolvePaymentAccount(tx, input.method, input.accountId) : null;
    await tx
      .update(lease)
      .set({
        depositSettledOn: input.settledOn,
        depositRefunded: refunded,
        depositRetained: retained,
        depositRetentionReason: retained > 0n ? input.reason : null,
        depositRefundMethod: refunded > 0n ? input.method : null,
        depositRefundAccountId: accountId,
      })
      .where(eq(lease.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "lease.settle_deposit",
      entityType: "lease",
      entityId: current.id,
      after: { held, refunded, retained, settledOn: input.settledOn, accountId },
      reason: retained > 0n ? (input.reason ?? undefined) : undefined,
    });
  });
}

/** Stores the signed lease (scan) and links it; the previous scan is discarded. */
export async function setLeaseContractScan(
  ctx: TenantCtx,
  input: { leaseId: string; upload: Upload },
): Promise<{ fileId: string }> {
  assertCan(ctx, "lease:update");
  const contentType = checkUpload("lease.contract", input.upload);
  return withTenant(ctx, async (tx) => {
    const current = await loadLease(tx, input.leaseId);
    const stored = await storeFile(tx, ctx, {
      entityType: LEASE_ENTITY,
      entityId: current.id,
      upload: input.upload,
      contentType,
    });
    await tx.update(lease).set({ contractScanFileId: stored.id }).where(eq(lease.id, current.id));
    if (current.contractScanFileId) await discardFile(tx, current.contractScanFileId);
    return { fileId: stored.id };
  });
}

/**
 * Records the état des lieux d'entrée (active lease) or de sortie (when the tenant leaves,
 * before or after the end is recorded): one of each, final; the bilingual report is rendered
 * by the worker. Audited on the lease.
 */
export async function recordInspection(ctx: TenantCtx, input: In<typeof recordInspectionSchema>) {
  assertCan(ctx, "lease:update");
  assertNotFuture(input.inspectedOn, "inspectedOn");
  return withTenant(ctx, async (tx) => {
    const current = await loadLease(tx, input.leaseId);
    if (input.kind === "check_in") assertActive(current);
    if (input.inspectedOn < current.signedOn) {
      throw invalid("inspectedOn", "rentals.errors.beforeSigning");
    }
    const [existing] = await tx
      .select({ id: leaseInspection.id })
      .from(leaseInspection)
      .where(and(eq(leaseInspection.leaseId, current.id), eq(leaseInspection.kind, input.kind)));
    if (existing) throw new AppError("CONFLICT", "rentals.errors.inspectionRecorded");
    const { leaseId: _l, ...fields } = input;
    const [row] = await tx
      .insert(leaseInspection)
      .values({ ...fields, organizationId: ctx.orgId, leaseId: current.id, createdBy: ctx.userId })
      .returning({ id: leaseInspection.id });
    if (!row) throw new Error("recordInspection: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "lease.inspection",
      entityType: "lease",
      entityId: current.id,
      after: { kind: input.kind, inspectedOn: input.inspectedOn, items: input.items.length },
    });
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "lease_inspection", id: row.id },
      { singletonKey: `lease_inspection:${row.id}` },
    );
    return { id: row.id };
  });
}

/** Requests an état des lieux's PDF again when it is still missing (idempotent job). */
export async function requestInspectionReport(ctx: TenantCtx, inspectionId: string) {
  assertCan(ctx, "lease:read");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ pdfFileId: leaseInspection.pdfFileId })
      .from(leaseInspection)
      .where(eq(leaseInspection.id, inspectionId));
    if (!row) throw new AppError("NOT_FOUND");
    if (row.pdfFileId) return;
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "lease_inspection", id: inspectionId },
      { singletonKey: `lease_inspection:${inspectionId}` },
    );
  });
}

/** Requests a quittance's PDF again when it is still missing (idempotent job). */
export async function requestRentReceipt(ctx: TenantCtx, paymentId: string) {
  assertCan(ctx, "lease:read");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ pdfFileId: rentPayment.pdfFileId })
      .from(rentPayment)
      .where(eq(rentPayment.id, paymentId));
    if (!row) throw new AppError("NOT_FOUND");
    if (row.pdfFileId) return;
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "rent_receipt", id: paymentId },
      { singletonKey: `rent_receipt:${paymentId}` },
    );
  });
}
