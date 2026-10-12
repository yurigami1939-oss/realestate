import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { consoleDb, type ConsoleTx } from "@/db/console-client";
import { addon, plan } from "@/db/schema";
import { AppError } from "@/lib/result";

import { recordConsoleAudit } from "./audit";
import type { OperatorCtx } from "./context";
import type { AddonInput, PlanInput } from "./schemas";

/** Adds a plan to the catalog. A plan in use is never edited: a change is a new plan. */
export async function createPlan(
  ctx: OperatorCtx,
  input: PlanInput,
  tx?: ConsoleTx,
): Promise<{ id: string }> {
  const run = async (trx: ConsoleTx) => {
    const [taken] = await trx.select({ id: plan.id }).from(plan).where(eq(plan.code, input.code));
    if (taken) throw new AppError("CONFLICT", "console.errors.planCodeTaken");
    const [created] = await trx
      .insert(plan)
      .values({
        code: input.code,
        nameFr: input.nameFr,
        nameAr: input.nameAr,
        yearlyPrice: input.yearlyPrice,
        quarterlyPrice: input.quarterlyPrice,
        setupFee: input.setupFee,
        modules: input.modules,
        limits: {
          activeUnits: input.activeUnits,
          organizations: input.organizations,
          storageGb: input.storageGb,
        },
        onQuote: input.onQuote,
      })
      .returning({ id: plan.id });
    if (!created) throw new Error("createPlan: no row");
    await recordConsoleAudit(trx, ctx, { action: "plan.create", after: input });
    return created;
  };
  return tx ? run(tx) : consoleDb.transaction(run);
}

/** Adds an add-on to the catalog (one live row per code; a new price archives the old one). */
export async function createAddon(
  ctx: OperatorCtx,
  input: AddonInput,
  tx?: ConsoleTx,
): Promise<{ id: string }> {
  const run = async (trx: ConsoleTx) => {
    const [live] = await trx
      .select({ id: addon.id })
      .from(addon)
      .where(and(eq(addon.code, input.code), isNull(addon.archivedAt)));
    if (live) throw new AppError("CONFLICT", "console.errors.addonCodeTaken");
    const [created] = await trx.insert(addon).values(input).returning({ id: addon.id });
    if (!created) throw new Error("createAddon: no row");
    await recordConsoleAudit(trx, ctx, { action: "addon.create", after: input });
    return created;
  };
  return tx ? run(tx) : consoleDb.transaction(run);
}
