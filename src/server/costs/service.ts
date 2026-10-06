import "server-only";

import { and, eq, isNull, max, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { project, projectBudgetLine, supplier, worksContract, worksInvoice } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { invoiceSplit } from "@/lib/costs";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { checkUpload, discardFile, storeFile, type Upload } from "@/server/files/service";
import { resolvePaymentAccount } from "@/server/treasury/service";

import type {
  acceptContractSchema,
  contractIdSchema,
  createContractorSchema,
  createContractSchema,
  createWorksInvoiceSchema,
  payWorksInvoiceSchema,
  releaseRetentionSchema,
  saveBudgetLinesSchema,
  terminateContractSchema,
  updateContractSchema,
  updateWorksInvoiceSchema,
  worksInvoiceIdSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

const assertNotFuture = (day: string, field: string) => {
  if (day > todayInAlgiers()) throw invalid(field, "sales.errors.futureDate");
};

async function loadProject(tx: Tx, projectId: string) {
  const [row] = await tx
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), isNull(project.deletedAt)));
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

async function loadContract(tx: Tx, contractId: string) {
  const [row] = await tx
    .select()
    .from(worksContract)
    .where(and(eq(worksContract.id, contractId), isNull(worksContract.deletedAt)))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

async function loadInvoice(tx: Tx, invoiceId: string) {
  const [row] = await tx
    .select({ invoice: worksInvoice, contract: worksContract })
    .from(worksInvoice)
    .innerJoin(worksContract, eq(worksContract.id, worksInvoice.contractId))
    .where(and(eq(worksInvoice.id, invoiceId), isNull(worksContract.deletedAt)))
    .for("update", { of: worksInvoice });
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** Totals invoiced on a contract (gross, retention), the given invoice left out. */
async function invoicedOn(tx: Tx, contractId: string, except: string | null = null) {
  const [row] = await tx
    .select({
      gross: sql<string>`coalesce(sum(${worksInvoice.gross}), 0)::text`,
      retention: sql<string>`coalesce(sum(${worksInvoice.retention}), 0)::text`,
    })
    .from(worksInvoice)
    .where(
      and(
        eq(worksInvoice.contractId, contractId),
        except ? sql`${worksInvoice.id} <> ${except}` : undefined,
      ),
    );
  return { gross: BigInt(row?.gross ?? "0"), retention: BigInt(row?.retention ?? "0") };
}

/** Saves a project's budget as a whole (`cost:update`), audited before / after. */
export async function saveBudgetLines(ctx: TenantCtx, input: In<typeof saveBudgetLinesSchema>) {
  assertCan(ctx, "cost:update");
  await withTenant(ctx, async (tx) => {
    await loadProject(tx, input.projectId);
    const before = await tx
      .select({
        category: projectBudgetLine.category,
        label: projectBudgetLine.label,
        amount: projectBudgetLine.amount,
      })
      .from(projectBudgetLine)
      .where(eq(projectBudgetLine.projectId, input.projectId))
      .orderBy(projectBudgetLine.position);
    await tx.delete(projectBudgetLine).where(eq(projectBudgetLine.projectId, input.projectId));
    if (input.lines.length > 0) {
      await tx.insert(projectBudgetLine).values(
        input.lines.map((line, index) => ({
          organizationId: ctx.orgId,
          projectId: input.projectId,
          position: index + 1,
          ...line,
        })),
      );
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "project_budget.save",
      entityType: "project",
      entityId: input.projectId,
      before: { lines: before },
      after: { lines: input.lines },
    });
  });
}

/** A contractor or design office added from the costs (kept with the suppliers). */
export async function createContractor(ctx: TenantCtx, input: In<typeof createContractorSchema>) {
  assertCan(ctx, "cost:update");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(supplier)
      .values({ organizationId: ctx.orgId, ...input, createdBy: ctx.userId })
      .returning({ id: supplier.id });
    if (!row) throw new Error("createContractor: no row returned");
    return { id: row.id };
  });
}

async function assertSupplier(tx: Tx, supplierId: string) {
  const [row] = await tx
    .select({ id: supplier.id })
    .from(supplier)
    .where(and(eq(supplier.id, supplierId), isNull(supplier.deletedAt)));
  if (!row) throw invalid("supplierId", "costs.errors.supplierNotFound");
}

const contractValues = (
  input: In<typeof createContractSchema> | In<typeof updateContractSchema>,
) => ({
  supplierId: input.supplierId,
  category: input.category,
  reference: input.reference,
  title: input.title,
  amount: input.amount,
  retentionBp: input.retention,
  signedOn: input.signedOn,
  plannedEndOn: input.plannedEndOn,
  notes: input.notes,
});

/** Records a contract (marché) with a contractor for a project (`cost:update`), audited. */
export async function createContract(ctx: TenantCtx, input: In<typeof createContractSchema>) {
  assertCan(ctx, "cost:update");
  assertNotFuture(input.signedOn, "signedOn");
  return withTenant(ctx, async (tx) => {
    await loadProject(tx, input.projectId);
    await assertSupplier(tx, input.supplierId);
    const values = contractValues(input);
    const [row] = await tx
      .insert(worksContract)
      .values({
        organizationId: ctx.orgId,
        projectId: input.projectId,
        ...values,
        createdBy: ctx.userId,
      })
      .returning({ id: worksContract.id });
    if (!row) throw new Error("createContract: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "works_contract.create",
      entityType: "works_contract",
      entityId: row.id,
      after: values,
    });
    return { id: row.id };
  });
}

/**
 * Corrects a contract: never below what is already invoiced; the retention rate is fixed once
 * a progress invoice exists. Not after its réception définitive or termination.
 */
export async function updateContract(ctx: TenantCtx, input: In<typeof updateContractSchema>) {
  assertCan(ctx, "cost:update");
  assertNotFuture(input.signedOn, "signedOn");
  await withTenant(ctx, async (tx) => {
    const current = await loadContract(tx, input.contractId);
    if (current.finalAcceptanceOn || current.terminatedOn) {
      throw new AppError("CONFLICT", "costs.errors.contractClosed");
    }
    await assertSupplier(tx, input.supplierId);
    const invoiced = await invoicedOn(tx, current.id);
    if (input.amount < invoiced.gross) throw invalid("amount", "costs.errors.belowInvoiced");
    if (invoiced.gross > 0n && input.retention !== current.retentionBp) {
      throw invalid("retention", "costs.errors.retentionFixed");
    }
    const values = contractValues(input);
    await tx
      .update(worksContract)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(worksContract.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "works_contract.update",
      entityType: "works_contract",
      entityId: current.id,
      before: contractValues({
        contractId: current.id,
        supplierId: current.supplierId,
        category: current.category,
        reference: current.reference,
        title: current.title,
        amount: current.amount,
        retention: current.retentionBp,
        signedOn: current.signedOn,
        plannedEndOn: current.plannedEndOn,
        notes: current.notes,
      }),
      after: values,
    });
  });
}

/** Deletes a contract without any progress invoice (soft delete), audited. */
export async function deleteContract(ctx: TenantCtx, input: In<typeof contractIdSchema>) {
  assertCan(ctx, "cost:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadContract(tx, input.contractId);
    if ((await invoicedOn(tx, current.id)).gross > 0n) {
      throw new AppError("CONFLICT", "costs.errors.contractInvoiced");
    }
    await tx
      .update(worksContract)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(worksContract.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "works_contract.delete",
      entityType: "works_contract",
      entityId: current.id,
      before: { title: current.title, amount: current.amount },
    });
  });
}

/**
 * Réception provisoire, then définitive (after the provisional one, from it on): dated, with
 * notes; the définitive makes the retention payable. Audited.
 */
export async function acceptContract(ctx: TenantCtx, input: In<typeof acceptContractSchema>) {
  assertCan(ctx, "cost:update");
  assertNotFuture(input.acceptedOn, "acceptedOn");
  await withTenant(ctx, async (tx) => {
    const current = await loadContract(tx, input.contractId);
    if (current.terminatedOn) throw new AppError("CONFLICT", "costs.errors.contractClosed");
    if (input.acceptedOn < current.signedOn) {
      throw invalid("acceptedOn", "costs.errors.beforeSigning");
    }
    if (input.stage === "provisional") {
      if (current.provisionalAcceptanceOn) {
        throw new AppError("CONFLICT", "costs.errors.alreadyAccepted");
      }
    } else {
      if (!current.provisionalAcceptanceOn) {
        throw new AppError("CONFLICT", "costs.errors.provisionalFirst");
      }
      if (current.finalAcceptanceOn) throw new AppError("CONFLICT", "costs.errors.alreadyAccepted");
      if (input.acceptedOn < current.provisionalAcceptanceOn) {
        throw invalid("acceptedOn", "costs.errors.beforeProvisional");
      }
    }
    const notes = [current.acceptanceNotes, input.notes].filter(Boolean).join("\n") || null;
    await tx
      .update(worksContract)
      .set({
        ...(input.stage === "provisional"
          ? { provisionalAcceptanceOn: input.acceptedOn }
          : { finalAcceptanceOn: input.acceptedOn }),
        acceptanceNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(worksContract.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: `works_contract.accept_${input.stage}`,
      entityType: "works_contract",
      entityId: current.id,
      after: { acceptedOn: input.acceptedOn, notes: input.notes },
    });
  });
}

/** Résiliation: no more progress invoices; what was invoiced stays due. Audited. */
export async function terminateContract(ctx: TenantCtx, input: In<typeof terminateContractSchema>) {
  assertCan(ctx, "cost:update");
  assertNotFuture(input.terminatedOn, "terminatedOn");
  await withTenant(ctx, async (tx) => {
    const current = await loadContract(tx, input.contractId);
    if (current.terminatedOn || current.finalAcceptanceOn) {
      throw new AppError("CONFLICT", "costs.errors.contractClosed");
    }
    await tx
      .update(worksContract)
      .set({ terminatedOn: input.terminatedOn, updatedAt: new Date() })
      .where(eq(worksContract.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "works_contract.terminate",
      entityType: "works_contract",
      entityId: current.id,
      after: { terminatedOn: input.terminatedOn },
      reason: input.reason,
    });
  });
}

/**
 * Pays the retention held on a contract back to the contractor after the réception définitive
 * (`cost:pay`), from an account; once. Audited.
 */
export async function releaseRetention(ctx: TenantCtx, input: In<typeof releaseRetentionSchema>) {
  assertCan(ctx, "cost:pay");
  assertNotFuture(input.paidOn, "paidOn");
  await withTenant(ctx, async (tx) => {
    const current = await loadContract(tx, input.contractId);
    if (!current.finalAcceptanceOn) throw new AppError("CONFLICT", "costs.errors.notFinal");
    if (current.retentionReleasedOn) throw new AppError("CONFLICT", "costs.errors.released");
    if (input.paidOn < current.finalAcceptanceOn) {
      throw invalid("paidOn", "costs.errors.beforeFinal");
    }
    const { retention } = await invoicedOn(tx, current.id);
    if (retention === 0n) throw new AppError("CONFLICT", "costs.errors.noRetention");
    const accountId = await resolvePaymentAccount(tx, input.method, input.accountId);
    await tx
      .update(worksContract)
      .set({
        retentionReleasedOn: input.paidOn,
        retentionReleased: retention,
        retentionMethod: input.method,
        retentionReference: input.reference,
        retentionAccountId: accountId,
        updatedAt: new Date(),
      })
      .where(eq(worksContract.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "works_contract.release_retention",
      entityType: "works_contract",
      entityId: current.id,
      after: { paidOn: input.paidOn, amount: retention, method: input.method, accountId },
    });
  });
}

/**
 * Records a progress invoice (`cost:update`): numbered on its contract, its retention at the
 * contract's rate; the contract's total invoiced never above its amount; not on a closed or
 * terminated contract. Audited.
 */
export async function recordWorksInvoice(
  ctx: TenantCtx,
  input: In<typeof createWorksInvoiceSchema>,
) {
  assertCan(ctx, "cost:update");
  assertNotFuture(input.invoicedOn, "invoicedOn");
  return withTenant(ctx, async (tx) => {
    const contract = await loadContract(tx, input.contractId);
    if (contract.terminatedOn || contract.finalAcceptanceOn) {
      throw new AppError("CONFLICT", "costs.errors.contractClosed");
    }
    if (input.invoicedOn < contract.signedOn) {
      throw invalid("invoicedOn", "costs.errors.beforeSigning");
    }
    const invoiced = await invoicedOn(tx, contract.id);
    if (invoiced.gross + input.gross > contract.amount) {
      throw invalid("gross", "costs.errors.aboveContract");
    }
    const [last] = await tx
      .select({ position: max(worksInvoice.position) })
      .from(worksInvoice)
      .where(eq(worksInvoice.contractId, contract.id));
    const { retention, net } = invoiceSplit(input.gross, contract.retentionBp);
    const [row] = await tx
      .insert(worksInvoice)
      .values({
        organizationId: ctx.orgId,
        contractId: contract.id,
        position: (last?.position ?? 0) + 1,
        number: input.number,
        invoicedOn: input.invoicedOn,
        dueOn: input.dueOn,
        label: input.label,
        gross: input.gross,
        retention,
        net,
        createdBy: ctx.userId,
      })
      .returning({ id: worksInvoice.id });
    if (!row) throw new Error("recordWorksInvoice: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "works_invoice.create",
      entityType: "works_contract",
      entityId: contract.id,
      after: { id: row.id, number: input.number, gross: input.gross, retention, net },
    });
    return { id: row.id, retention, net };
  });
}

/** Corrects an unpaid progress invoice (amount, dates, number). Audited. */
export async function updateWorksInvoice(
  ctx: TenantCtx,
  input: In<typeof updateWorksInvoiceSchema>,
) {
  assertCan(ctx, "cost:update");
  assertNotFuture(input.invoicedOn, "invoicedOn");
  await withTenant(ctx, async (tx) => {
    const { invoice, contract } = await loadInvoice(tx, input.invoiceId);
    if (invoice.paidOn) throw new AppError("CONFLICT", "costs.errors.invoicePaid");
    if (input.invoicedOn < contract.signedOn) {
      throw invalid("invoicedOn", "costs.errors.beforeSigning");
    }
    const others = await invoicedOn(tx, contract.id, invoice.id);
    if (others.gross + input.gross > contract.amount) {
      throw invalid("gross", "costs.errors.aboveContract");
    }
    const { retention, net } = invoiceSplit(input.gross, contract.retentionBp);
    await tx
      .update(worksInvoice)
      .set({
        number: input.number,
        invoicedOn: input.invoicedOn,
        dueOn: input.dueOn,
        label: input.label,
        gross: input.gross,
        retention,
        net,
        updatedBy: ctx.userId,
      })
      .where(eq(worksInvoice.id, invoice.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "works_invoice.update",
      entityType: "works_contract",
      entityId: contract.id,
      before: { id: invoice.id, gross: invoice.gross, invoicedOn: invoice.invoicedOn },
      after: { id: invoice.id, gross: input.gross, invoicedOn: input.invoicedOn },
    });
  });
}

/** Deletes an unpaid progress invoice (the last one only, numbers stay continuous). */
export async function deleteWorksInvoice(ctx: TenantCtx, input: In<typeof worksInvoiceIdSchema>) {
  assertCan(ctx, "cost:update");
  await withTenant(ctx, async (tx) => {
    const { invoice, contract } = await loadInvoice(tx, input.invoiceId);
    if (invoice.paidOn) throw new AppError("CONFLICT", "costs.errors.invoicePaid");
    const [last] = await tx
      .select({ position: max(worksInvoice.position) })
      .from(worksInvoice)
      .where(eq(worksInvoice.contractId, contract.id));
    if (last?.position !== invoice.position) {
      throw new AppError("CONFLICT", "costs.errors.notLastInvoice");
    }
    await tx.delete(worksInvoice).where(eq(worksInvoice.id, invoice.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "works_invoice.delete",
      entityType: "works_contract",
      entityId: contract.id,
      before: { id: invoice.id, position: invoice.position, gross: invoice.gross },
    });
  });
}

/**
 * Pays a progress invoice's net amount (`cost:pay`): from the invoice day to today, from an
 * account (chosen, else the method's default); final. Audited.
 */
export async function payWorksInvoice(ctx: TenantCtx, input: In<typeof payWorksInvoiceSchema>) {
  assertCan(ctx, "cost:pay");
  assertNotFuture(input.paidOn, "paidOn");
  await withTenant(ctx, async (tx) => {
    const { invoice, contract } = await loadInvoice(tx, input.invoiceId);
    if (invoice.paidOn) throw new AppError("CONFLICT", "costs.errors.invoicePaid");
    if (input.paidOn < invoice.invoicedOn) {
      throw invalid("paidOn", "suppliers.errors.paidBeforeInvoice");
    }
    const accountId = await resolvePaymentAccount(tx, input.method, input.accountId);
    await tx
      .update(worksInvoice)
      .set({
        paidOn: input.paidOn,
        paymentMethod: input.method,
        paymentReference: input.reference,
        accountId,
        updatedBy: ctx.userId,
      })
      .where(eq(worksInvoice.id, invoice.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "works_invoice.pay",
      entityType: "works_contract",
      entityId: contract.id,
      after: {
        id: invoice.id,
        net: invoice.net,
        paidOn: input.paidOn,
        method: input.method,
        accountId,
      },
    });
  });
}

/** Attaches or replaces the signed contract's scan or a progress invoice's scan. */
export async function setCostScan(
  ctx: TenantCtx,
  input: { kind: "contract" | "invoice"; id: string; upload: Upload },
) {
  assertCan(ctx, "cost:update");
  const purpose = input.kind === "contract" ? "works_contract.scan" : "works_invoice.scan";
  const contentType = checkUpload(purpose, input.upload);
  return withTenant(ctx, async (tx) => {
    if (input.kind === "contract") {
      const current = await loadContract(tx, input.id);
      const stored = await storeFile(tx, ctx, {
        entityType: "works_contract",
        entityId: current.id,
        upload: input.upload,
        contentType,
      });
      await tx
        .update(worksContract)
        .set({ scanFileId: stored.id, updatedAt: new Date() })
        .where(eq(worksContract.id, current.id));
      if (current.scanFileId) await discardFile(tx, current.scanFileId);
      return { fileId: stored.id };
    }
    const { invoice, contract } = await loadInvoice(tx, input.id);
    const stored = await storeFile(tx, ctx, {
      entityType: "works_contract",
      entityId: contract.id,
      upload: input.upload,
      contentType,
    });
    await tx
      .update(worksInvoice)
      .set({ scanFileId: stored.id })
      .where(eq(worksInvoice.id, invoice.id));
    if (invoice.scanFileId) await discardFile(tx, invoice.scanFileId);
    return { fileId: stored.id };
  });
}
