import "server-only";

import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  handover,
  lease,
  onlinePayment,
  organizationSetting,
  residence,
  treasuryAccount,
  warrantyClaim,
  worksContract,
  worksInvoice,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { dependantsOf, type Module, moduleDeps } from "@/lib/modules";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { readAccess } from "./access";

/**
 * What still uses a module (CLAUDE.console.md §5, « can be switched off when »): the live
 * records that would be stranded without it. Zero: the module can go off. Never deletes data.
 */
export async function moduleBlockers(tx: Tx, module: Module): Promise<number> {
  const n = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
  switch (module) {
    case "construction":
      return (
        (await n(
          tx.select({ n: count() }).from(handover).where(eq(handover.status, "scheduled")),
        )) +
        (await n(
          tx
            .select({ n: count() })
            .from(warrantyClaim)
            .where(inArray(warrantyClaim.status, ["open", "assigned"])),
        ))
      );
    case "costs":
      return (
        (await n(
          tx
            .select({ n: count() })
            .from(worksInvoice)
            .innerJoin(worksContract, eq(worksContract.id, worksInvoice.contractId))
            .where(and(isNull(worksInvoice.paidOn), isNull(worksContract.deletedAt))),
        )) +
        (await n(
          tx
            .select({ n: count() })
            .from(worksContract)
            .where(
              and(
                isNull(worksContract.deletedAt),
                isNull(worksContract.retentionReleasedOn),
                sql`exists (select 1 from works_invoice i where i.contract_id = ${worksContract.id}
                            and i.paid_on is not null and i.retention > 0)`,
              ),
            ),
        ))
      );
    case "treasury":
      return n(
        tx.select({ n: count() }).from(treasuryAccount).where(isNull(treasuryAccount.closedOn)),
      );
    case "syndic":
      return n(tx.select({ n: count() }).from(residence).where(isNull(residence.deletedAt)));
    case "rentals":
      return n(tx.select({ n: count() }).from(lease).where(eq(lease.status, "active")));
    case "online_payment":
      return (
        (await n(
          tx
            .select({ n: count() })
            .from(onlinePayment)
            .where(inArray(onlinePayment.status, ["created", "pending"])),
        )) +
        (await n(
          tx
            .select({ n: count() })
            .from(onlinePayment)
            .where(and(eq(onlinePayment.status, "paid"), isNotNull(onlinePayment.issue))),
        ))
      );
    case "imports":
    case "reports":
    case "portal":
    case "lead_capture":
    case "whatsapp":
      return 0;
  }
}

/**
 * The gérant switches an entitled module on or off for the organization (CLAUDE.console.md
 * §5): off only once nothing uses it and no module that needs it is on; on only when the
 * subscription includes it and what it needs is on. Audited `organization.modules`.
 */
export async function setModuleEnabled(
  ctx: TenantCtx,
  input: { module: Module; on: boolean },
): Promise<void> {
  assertCan(ctx, "organization:update");
  await withTenant(ctx, async (tx) => {
    const access = await readAccess(tx);
    const { module, on } = input;
    if (!access.entitled.includes(module)) {
      throw new AppError("CONFLICT", "subscription.errors.notIncluded");
    }
    const disabled = new Set(access.disabled);
    if (on) {
      const missing = (moduleDeps[module] ?? []).find((m) => !access.modules.includes(m));
      if (missing) {
        throw new AppError("CONFLICT", "subscription.errors.needs", {
          details: { module: missing },
        });
      }
      disabled.delete(module);
    } else {
      const dependant = dependantsOf(module).find((m) => access.modules.includes(m));
      if (dependant) {
        throw new AppError("CONFLICT", "subscription.errors.dependant", {
          details: { module: dependant },
        });
      }
      const blockers = await moduleBlockers(tx, module);
      if (blockers > 0) {
        throw new AppError("CONFLICT", `subscription.blocked.${module}`, {
          details: { count: blockers },
        });
      }
      disabled.add(module);
    }
    const next = [...disabled].sort();
    if (next.join() === [...access.disabled].sort().join()) return;
    await tx
      .insert(organizationSetting)
      .values({
        organizationId: ctx.orgId,
        disabledModules: next as Module[],
        updatedBy: ctx.userId,
      })
      .onConflictDoUpdate({
        target: organizationSetting.organizationId,
        set: { disabledModules: next as Module[], updatedBy: ctx.userId, updatedAt: new Date() },
      });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.modules",
      entityType: "organization",
      entityId: ctx.orgId,
      before: { disabled: access.disabled },
      after: { disabled: next },
    });
  });
}
