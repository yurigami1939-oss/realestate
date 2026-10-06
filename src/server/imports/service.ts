import "server-only";

import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import type { TenantCtx } from "@/server/auth/session";

import { prepareBankStatement } from "./bank-statement";
import { prepareBuyers } from "./buyers";
import { prepareLeads } from "./leads";
import type { ImportPlan } from "./plan";
import { prepareResidents } from "./residents";
import { prepareSales } from "./sales";
import type { ImportKind, ImportReport } from "./schemas";
import { readWorkbook } from "./sheets";
import { prepareUnits } from "./units";

/**
 * A data import (reprise, CLAUDE.md §7 Imports): every row of the file is checked first; with
 * `commit` and nothing blocking, everything is written in one transaction — all or nothing —
 * through the same services as by hand (numbers, histories, audit), then the import itself is
 * audited (`organization.import`).
 */
export async function runImport(
  ctx: TenantCtx,
  kind: ImportKind,
  bytes: Buffer,
  options: { projectId?: string; residenceId?: string; accountId?: string; commit: boolean },
): Promise<ImportReport> {
  const workbook = await readWorkbook(bytes);
  if (!workbook) throw new AppError("VALIDATION", "imports.errors.notExcel");
  let plan: ImportPlan;
  switch (kind) {
    case "units":
      if (!options.projectId) throw new AppError("VALIDATION", "imports.errors.projectRequired");
      plan = await prepareUnits(ctx, workbook, { projectId: options.projectId });
      break;
    case "buyers":
      plan = await prepareBuyers(ctx, workbook);
      break;
    case "sales":
      plan = await prepareSales(ctx, workbook);
      break;
    case "leads":
      plan = await prepareLeads(ctx, workbook);
      break;
    case "residents":
      if (!options.residenceId) {
        throw new AppError("VALIDATION", "imports.errors.residenceRequired");
      }
      plan = await prepareResidents(ctx, workbook, { residenceId: options.residenceId });
      break;
    case "bank_statement":
      if (!options.accountId) throw new AppError("VALIDATION", "imports.errors.accountRequired");
      plan = await prepareBankStatement(ctx, workbook, { accountId: options.accountId });
      break;
  }
  const nothing = Object.values(plan.counts).every((n) => n === 0);
  const report = (committed: boolean): ImportReport => ({
    kind,
    committed,
    counts: plan.counts,
    issues: plan.issues,
    warnings: plan.warnings,
  });
  if (!options.commit || plan.issues.length > 0 || nothing) return report(false);
  await withTenant(ctx, async (tx) => {
    await plan.apply(tx);
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.import",
      entityType: "organization",
      entityId: ctx.orgId,
      after: { kind, counts: plan.counts, warnings: plan.warnings.length },
    });
  });
  return report(true);
}
