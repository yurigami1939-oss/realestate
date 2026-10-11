import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { chargeCategory, supplier, supplierInvoice } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { loadBudgetReport } from "@/server/charges/report";

import { type PortalCtx, portalScope } from "./context";

/** Residences where the portal account sits on the residents' council (a current co-owner). */
export async function councilResidences(tx: Tx, userId: string): Promise<string[]> {
  const { residents } = await portalScope(tx, { userId });
  return [
    ...new Set(
      residents.filter((r) => r.kind === "co_owner" && r.councilMember).map((r) => r.residenceId),
    ),
  ];
}

/**
 * The accounts of a residence for its residents' council (CLAUDE.md §7 Residence charges): the
 * year's budget against actual per category, the reserve fund, and the year's supplier invoices
 * with their scans. Null unless the account sits on that residence's council.
 */
export async function getPortalCouncil(ctx: PortalCtx, residenceId: string, year: number) {
  if (!isUuid(residenceId)) return null;
  return withTenant(ctx, async (tx) => {
    if (!(await councilResidences(tx, ctx.userId)).includes(residenceId)) return null;
    const report = await loadBudgetReport(tx, residenceId, year);
    if (!report) return null;
    const invoices = await tx
      .select({
        id: supplierInvoice.id,
        supplierName: supplier.name,
        number: supplierInvoice.number,
        invoiceOn: supplierInvoice.invoiceOn,
        label: supplierInvoice.label,
        categoryName: chargeCategory.name,
        fromReserve: supplierInvoice.fromReserve,
        amount: supplierInvoice.amount,
        paidOn: supplierInvoice.paidOn,
        scanFileId: supplierInvoice.scanFileId,
      })
      .from(supplierInvoice)
      .innerJoin(supplier, eq(supplier.id, supplierInvoice.supplierId))
      .leftJoin(chargeCategory, eq(chargeCategory.id, supplierInvoice.categoryId))
      .where(
        and(
          eq(supplierInvoice.residenceId, residenceId),
          isNull(supplierInvoice.deletedAt),
          sql`extract(year from ${supplierInvoice.invoiceOn}) = ${year}`,
        ),
      )
      .orderBy(desc(supplierInvoice.invoiceOn));
    return { report, invoices };
  });
}

/** Whether a supplier invoice's scan may be read by the portal account (its council). */
export async function isPortalCouncilInvoice(tx: Tx, userId: string, invoiceId: string) {
  const [row] = await tx
    .select({ residenceId: supplierInvoice.residenceId })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.id, invoiceId), isNull(supplierInvoice.deletedAt)));
  return row !== undefined && (await councilResidences(tx, userId)).includes(row.residenceId);
}
