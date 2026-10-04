import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { chargeCategory, supplier, supplierContract } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadResidence } from "@/server/residences/service";

import type {
  createContractSchema,
  createSupplierSchema,
  updateContractSchema,
  updateSupplierSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** A live supplier of the organization (locked when asked); NOT_FOUND otherwise. */
export async function loadSupplier(
  tx: Tx,
  supplierId: string,
  options: { forUpdate?: boolean } = {},
) {
  const query = tx
    .select()
    .from(supplier)
    .where(and(eq(supplier.id, supplierId), isNull(supplier.deletedAt)));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

export async function createSupplier(ctx: TenantCtx, input: In<typeof createSupplierSchema>) {
  assertCan(ctx, "supplier:update");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(supplier)
      .values({ ...input, organizationId: ctx.orgId, createdBy: ctx.userId })
      .returning({ id: supplier.id });
    if (!row) throw new Error("createSupplier: no row returned");
    return { id: row.id };
  });
}

export async function updateSupplier(ctx: TenantCtx, input: In<typeof updateSupplierSchema>) {
  assertCan(ctx, "supplier:update");
  const { supplierId, ...fields } = input;
  await withTenant(ctx, async (tx) => {
    await loadSupplier(tx, supplierId, { forUpdate: true });
    await tx.update(supplier).set(fields).where(eq(supplier.id, supplierId));
  });
}

/** Removes a supplier (soft delete); its contracts and invoices keep pointing at it. */
export async function deleteSupplier(ctx: TenantCtx, supplierId: string) {
  assertCan(ctx, "supplier:update");
  await withTenant(ctx, async (tx) => {
    await loadSupplier(tx, supplierId, { forUpdate: true });
    await tx
      .update(supplier)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(supplier.id, supplierId));
  });
}

/** A category given for a contract or an invoice belongs to the residence and is live. */
export async function checkCategory(tx: Tx, residenceId: string, categoryId: string | null) {
  if (categoryId === null) return;
  const [row] = await tx
    .select({ id: chargeCategory.id })
    .from(chargeCategory)
    .where(
      and(
        eq(chargeCategory.id, categoryId),
        eq(chargeCategory.residenceId, residenceId),
        isNull(chargeCategory.deletedAt),
      ),
    );
  if (!row) throw invalid("categoryId", "charges.errors.categoryNotFound");
}

/** Contract of a supplier for a residence. */
export async function createContract(ctx: TenantCtx, input: In<typeof createContractSchema>) {
  assertCan(ctx, "supplier:update");
  return withTenant(ctx, async (tx) => {
    await loadSupplier(tx, input.supplierId);
    const home = await loadResidence(tx, input.residenceId);
    await checkCategory(tx, home.id, input.categoryId);
    const [row] = await tx
      .insert(supplierContract)
      .values({ ...input, organizationId: ctx.orgId, createdBy: ctx.userId })
      .returning({ id: supplierContract.id });
    if (!row) throw new Error("createContract: no row returned");
    return { id: row.id };
  });
}

async function loadContract(tx: Tx, contractId: string) {
  const [row] = await tx
    .select()
    .from(supplierContract)
    .where(and(eq(supplierContract.id, contractId), isNull(supplierContract.deletedAt)))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

export async function updateContract(ctx: TenantCtx, input: In<typeof updateContractSchema>) {
  assertCan(ctx, "supplier:update");
  const { contractId, ...fields } = input;
  await withTenant(ctx, async (tx) => {
    const current = await loadContract(tx, contractId);
    await checkCategory(tx, current.residenceId, fields.categoryId);
    await tx.update(supplierContract).set(fields).where(eq(supplierContract.id, contractId));
  });
}

export async function deleteContract(ctx: TenantCtx, contractId: string) {
  assertCan(ctx, "supplier:update");
  await withTenant(ctx, async (tx) => {
    await loadContract(tx, contractId);
    await tx
      .update(supplierContract)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(supplierContract.id, contractId));
  });
}
