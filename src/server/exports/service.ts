import "server-only";

import { withTenant } from "@/db/tenant";
import type { Locale } from "@/i18n/locales";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import type { TenantCtx } from "@/server/auth/session";

import { builders, type Translate } from "./builders";
import { type ExportKind, exportParams } from "./schemas";
import { buildWorkbook } from "./xlsx";

/**
 * Builds an .xlsx export (CLAUDE.md §5 Exports): its filters parsed, the rows read with the
 * member's rights and visibility, headers in their language (right to left in Arabic). Bulk
 * extracts of personal data are recorded in the audit log (Loi 18-07).
 */
export async function buildExport(
  ctx: TenantCtx,
  kind: ExportKind,
  query: Record<string, string>,
  locale: Locale,
  t: Translate,
): Promise<{ file: string; bytes: Buffer }> {
  const parsed = exportParams[kind].safeParse(query);
  if (!parsed.success) throw new AppError("VALIDATION");
  // Each builder takes the parsed filters of its own kind.
  const build = builders[kind] as (
    ctx: TenantCtx,
    params: typeof parsed.data,
    t: Translate,
  ) => ReturnType<(typeof builders)[ExportKind]>;
  const result = await build(ctx, parsed.data, t);
  const bytes = await buildWorkbook(result.sheets, { rightToLeft: locale === "ar" });
  await withTenant(ctx, (tx) =>
    recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.export",
      entityType: "organization",
      entityId: ctx.orgId,
      after: { kind, filters: parsed.data, rows: result.rows },
    }),
  );
  return { file: result.file, bytes };
}
