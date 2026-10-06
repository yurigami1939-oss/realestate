import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { supplierContract, supplierInvoice } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { checkUpload, discardFile, storeFile, type Upload } from "@/server/files/service";
import { loadResidence } from "@/server/residences/service";
import { resolvePaymentAccount } from "@/server/treasury/service";

import type { createInvoiceSchema, payInvoiceSchema, updateInvoiceSchema } from "./schemas";
import { checkCategory, loadSupplier } from "./service";

type In<S extends z.ZodType> = z.output<S>;
type InvoiceFields = Omit<In<typeof updateInvoiceSchema>, "invoiceId">;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

const numberTaken = () =>
  new AppError("CONFLICT", "suppliers.errors.invoiceNumberTaken", {
    fieldErrors: { number: ["suppliers.errors.invoiceNumberTaken"] },
  });

async function uniqueNumber<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw numberTaken();
    throw error;
  }
}

/** The category belongs to the residence; the contract to the supplier and the residence. */
async function checkBooking(
  tx: Tx,
  supplierId: string,
  residenceId: string,
  fields: InvoiceFields,
) {
  await checkCategory(tx, residenceId, fields.fromReserve ? null : fields.categoryId);
  if (fields.contractId === null) return;
  const [contract] = await tx
    .select({ id: supplierContract.id })
    .from(supplierContract)
    .where(
      and(
        eq(supplierContract.id, fields.contractId),
        eq(supplierContract.supplierId, supplierId),
        eq(supplierContract.residenceId, residenceId),
        isNull(supplierContract.deletedAt),
      ),
    );
  if (!contract) throw invalid("contractId", "suppliers.errors.contractMismatch");
}

const values = (fields: InvoiceFields) => ({
  ...fields,
  // Reserve fund works are not booked to the year's budget.
  categoryId: fields.fromReserve ? null : fields.categoryId,
});

/** Records a supplier invoice of a residence (supplier:update). Audited. */
export async function recordInvoice(ctx: TenantCtx, input: In<typeof createInvoiceSchema>) {
  assertCan(ctx, "supplier:update");
  const { supplierId, residenceId, ...fields } = input;
  return withTenant(ctx, async (tx) => {
    const source = await loadSupplier(tx, supplierId);
    const home = await loadResidence(tx, residenceId);
    await checkBooking(tx, source.id, home.id, fields);
    const [row] = await uniqueNumber(() =>
      tx
        .insert(supplierInvoice)
        .values({
          ...values(fields),
          organizationId: ctx.orgId,
          supplierId: source.id,
          residenceId: home.id,
          createdBy: ctx.userId,
        })
        .returning({ id: supplierInvoice.id }),
    );
    if (!row) throw new Error("recordInvoice: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "supplier_invoice.create",
      entityType: "supplier_invoice",
      entityId: row.id,
      after: { supplier: source.name, residence: home.name, ...values(fields) },
    });
    return { id: row.id };
  });
}

/** A live invoice (locked); NOT_FOUND otherwise. */
async function loadInvoice(tx: Tx, invoiceId: string) {
  const [row] = await tx
    .select()
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.id, invoiceId), isNull(supplierInvoice.deletedAt)))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** Edits an unpaid invoice. Audited. */
export async function updateInvoice(ctx: TenantCtx, input: In<typeof updateInvoiceSchema>) {
  assertCan(ctx, "supplier:update");
  const { invoiceId, ...fields } = input;
  await withTenant(ctx, async (tx) => {
    const current = await loadInvoice(tx, invoiceId);
    if (current.paidOn) throw new AppError("CONFLICT", "suppliers.errors.invoicePaid");
    await checkBooking(tx, current.supplierId, current.residenceId, fields);
    await uniqueNumber(() =>
      tx.update(supplierInvoice).set(values(fields)).where(eq(supplierInvoice.id, invoiceId)),
    );
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "supplier_invoice.update",
      entityType: "supplier_invoice",
      entityId: invoiceId,
      before: {
        number: current.number,
        amount: current.amount,
        categoryId: current.categoryId,
        fromReserve: current.fromReserve,
      },
      after: values(fields),
    });
  });
}

/** Records the payment of an invoice (date, method, reference); then it is read-only. */
export async function payInvoice(ctx: TenantCtx, input: In<typeof payInvoiceSchema>) {
  assertCan(ctx, "supplier:update");
  if (input.paidOn > todayInAlgiers()) throw invalid("paidOn", "charges.errors.futureDate");
  await withTenant(ctx, async (tx) => {
    const current = await loadInvoice(tx, input.invoiceId);
    if (current.paidOn) throw new AppError("CONFLICT", "suppliers.errors.invoicePaid");
    if (input.paidOn < current.invoiceOn) {
      throw invalid("paidOn", "suppliers.errors.paidBeforeInvoice");
    }
    await tx
      .update(supplierInvoice)
      .set({
        paidOn: input.paidOn,
        paymentMethod: input.method,
        paymentReference: input.reference,
        accountId: await resolvePaymentAccount(tx, input.method, input.accountId),
      })
      .where(eq(supplierInvoice.id, input.invoiceId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "supplier_invoice.pay",
      entityType: "supplier_invoice",
      entityId: input.invoiceId,
      after: {
        amount: current.amount,
        paidOn: input.paidOn,
        method: input.method,
        reference: input.reference,
      },
    });
  });
}

/** Removes an invoice recorded by mistake (soft delete), only while unpaid. Audited. */
export async function deleteInvoice(ctx: TenantCtx, invoiceId: string) {
  assertCan(ctx, "supplier:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadInvoice(tx, invoiceId);
    if (current.paidOn) throw new AppError("CONFLICT", "suppliers.errors.invoicePaid");
    await tx
      .update(supplierInvoice)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(supplierInvoice.id, invoiceId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "supplier_invoice.delete",
      entityType: "supplier_invoice",
      entityId: invoiceId,
      before: { number: current.number, amount: current.amount },
    });
  });
}

/**
 * Attaches (or replaces) an invoice's scan (supplier:update), paid or not; filed under the
 * invoice, readable with `supplier:read`. The replaced scan is discarded.
 */
export async function setInvoiceScan(
  ctx: TenantCtx,
  input: { invoiceId: string; upload: Upload },
): Promise<{ fileId: string }> {
  assertCan(ctx, "supplier:update");
  const contentType = checkUpload("supplier_invoice.scan", input.upload);
  return withTenant(ctx, async (tx) => {
    const current = await loadInvoice(tx, input.invoiceId);
    const stored = await storeFile(tx, ctx, {
      entityType: "supplier_invoice",
      entityId: current.id,
      upload: input.upload,
      contentType,
    });
    await tx
      .update(supplierInvoice)
      .set({ scanFileId: stored.id })
      .where(eq(supplierInvoice.id, current.id));
    if (current.scanFileId) await discardFile(tx, current.scanFileId);
    return { fileId: stored.id };
  });
}
