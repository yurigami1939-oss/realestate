import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { chargeCategory, residence, supplier, supplierContract } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";

/** A contract runs on a day between its start and its end (open-ended without end). */
const running = (day: string) =>
  sql<boolean>`${supplierContract.startOn} <= ${day}::date and (${supplierContract.endOn} is null or ${supplierContract.endOn} >= ${day}::date)`;

/** Suppliers of the organization by name, with their contracts running today. */
export async function listSuppliers(ctx: TenantCtx) {
  assertCan(ctx, "supplier:read");
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: supplier.id,
        name: supplier.name,
        activity: supplier.activity,
        phone: supplier.phone,
        email: supplier.email,
      })
      .from(supplier)
      .where(isNull(supplier.deletedAt))
      .orderBy(asc(supplier.name));
    const counts = await tx
      .select({ supplierId: supplierContract.supplierId, n: sql<number>`count(*)::int` })
      .from(supplierContract)
      .where(and(isNull(supplierContract.deletedAt), running(today)))
      .groupBy(supplierContract.supplierId);
    return rows.map((r) => ({
      ...r,
      runningContracts: counts.find((c) => c.supplierId === r.id)?.n ?? 0,
    }));
  });
}

export type SupplierRow = Awaited<ReturnType<typeof listSuppliers>>[number];

/** Contracts with their supplier, residence and category; `running` is derived for today. */
async function contracts(ctx: TenantCtx, where: { supplierId?: string; residenceId?: string }) {
  const today = todayInAlgiers();
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: supplierContract.id,
        supplierId: supplierContract.supplierId,
        supplierName: supplier.name,
        residenceId: supplierContract.residenceId,
        residenceName: residence.name,
        categoryId: supplierContract.categoryId,
        categoryName: chargeCategory.name,
        label: supplierContract.label,
        startOn: supplierContract.startOn,
        endOn: supplierContract.endOn,
        annualAmount: supplierContract.annualAmount,
        notes: supplierContract.notes,
        running: running(today),
      })
      .from(supplierContract)
      .innerJoin(supplier, eq(supplier.id, supplierContract.supplierId))
      .innerJoin(residence, eq(residence.id, supplierContract.residenceId))
      .leftJoin(chargeCategory, eq(chargeCategory.id, supplierContract.categoryId))
      .where(
        and(
          isNull(supplierContract.deletedAt),
          where.supplierId ? eq(supplierContract.supplierId, where.supplierId) : undefined,
          where.residenceId ? eq(supplierContract.residenceId, where.residenceId) : undefined,
        ),
      )
      .orderBy(desc(supplierContract.startOn), asc(supplierContract.label)),
  );
}

export type ContractRow = Awaited<ReturnType<typeof contracts>>[number];

/** Supplier sheet: details and contracts. */
export async function getSupplier(ctx: TenantCtx, supplierId: string) {
  assertCan(ctx, "supplier:read");
  if (!isUuid(supplierId)) return null;
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select()
      .from(supplier)
      .where(and(eq(supplier.id, supplierId), isNull(supplier.deletedAt))),
  );
  if (!row) return null;
  return { ...row, contracts: await contracts(ctx, { supplierId }) };
}

export type SupplierDetail = NonNullable<Awaited<ReturnType<typeof getSupplier>>>;

/** Contracts of a residence (any supplier). */
export async function listResidenceContracts(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "supplier:read");
  if (!isUuid(residenceId)) return [];
  return contracts(ctx, { residenceId });
}

/** Choices for the contract and invoice forms: live residences with their live categories. */
export async function listContractTargets(ctx: TenantCtx) {
  assertCan(ctx, "supplier:read");
  return withTenant(ctx, async (tx) => {
    const residences = await tx
      .select({ id: residence.id, name: residence.name })
      .from(residence)
      .where(isNull(residence.deletedAt))
      .orderBy(asc(residence.name));
    const categories = await tx
      .select({
        id: chargeCategory.id,
        residenceId: chargeCategory.residenceId,
        name: chargeCategory.name,
      })
      .from(chargeCategory)
      .where(isNull(chargeCategory.deletedAt))
      .orderBy(asc(chargeCategory.position), asc(chargeCategory.name));
    return residences.map((r) => ({
      ...r,
      categories: categories.filter((c) => c.residenceId === r.id),
    }));
  });
}

export type ContractTarget = Awaited<ReturnType<typeof listContractTargets>>[number];
