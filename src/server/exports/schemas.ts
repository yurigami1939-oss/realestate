/** Isomorphic: the spreadsheet exports, their filters (URL search params) and the page's links. */
import { z } from "zod";

import { buyerListParams } from "@/server/buyers/schemas";
import { leadListParams } from "@/server/crm/schemas";
import { saleListParams } from "@/server/sales/schemas";

export const exportKinds = [
  "collections",
  "sales",
  "installments",
  "units",
  "leads",
  "buyers",
  "charges",
  "leases",
  "invoices",
] as const;
export type ExportKind = (typeof exportKinds)[number];

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);
const optionalId = z.uuid().optional().catch(undefined);

/** The filters of each export, the same as its list page's where there is one. */
export const exportParams = {
  /** Journal of the money received over a period (default: this month). */
  collections: z.object({ from: day, to: day }),
  sales: saleListParams.omit({ page: true }),
  installments: z.object({}),
  units: z.object({ project: optionalId }),
  leads: leadListParams.omit({ page: true }),
  buyers: buyerListParams.omit({ page: true }),
  charges: z.object({ residence: z.uuid() }),
  leases: z.object({
    status: z.enum(["active", "ended", "all"]).optional().catch(undefined),
    project: optionalId,
  }),
  invoices: z.object({
    residence: optionalId,
    year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  }),
} as const satisfies Record<ExportKind, z.ZodType>;

export type ExportParams<K extends ExportKind> = z.output<(typeof exportParams)[K]>;

/** The download link of an export with its filters (empty values left out). */
export function exportHref(
  kind: ExportKind,
  params: Record<string, string | number | null | undefined> = {},
): string {
  const query = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      value === null || value === undefined || value === "" ? [] : [[key, String(value)]],
    ),
  ).toString();
  return `/api/exports/${kind}${query ? `?${query}` : ""}`;
}
