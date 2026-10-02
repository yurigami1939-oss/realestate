import "server-only";

import { and, eq, inArray, isNotNull, isNull, max } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { priceList, priceListItem, project, unit, unitPriceHistory } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type { createPriceListSchema, priceListIdSchema, setPriceListItemsSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Locks a price list and checks it is still a draft. */
async function lockDraft(tx: Tx, priceListId: string) {
  const [row] = await tx
    .select()
    .from(priceList)
    .where(eq(priceList.id, priceListId))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  if (row.status !== "draft") throw new AppError("CONFLICT", "inventory.errors.priceListNotDraft");
  return row;
}

/**
 * New draft grille for a project, numbered per project, prefilled with the current list
 * prices of its units (edit it, then apply).
 */
export async function createPriceList(ctx: TenantCtx, input: In<typeof createPriceListSchema>) {
  assertCan(ctx, "price:update");
  return withTenant(ctx, async (tx) => {
    // Serializes version numbering per project.
    const [parent] = await tx
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, input.projectId), isNull(project.deletedAt)))
      .for("update");
    if (!parent) throw new AppError("NOT_FOUND");

    const [last] = await tx
      .select({ version: max(priceList.version) })
      .from(priceList)
      .where(eq(priceList.projectId, input.projectId));

    const [created] = await tx
      .insert(priceList)
      .values({
        organizationId: ctx.orgId,
        projectId: input.projectId,
        version: (last?.version ?? 0) + 1,
        name: input.name,
        createdBy: ctx.userId,
      })
      .returning({ id: priceList.id, version: priceList.version });
    if (!created) throw new AppError("UNEXPECTED");

    const priced = await tx
      .select({ id: unit.id, listPrice: unit.listPrice })
      .from(unit)
      .where(
        and(eq(unit.projectId, input.projectId), isNull(unit.deletedAt), isNotNull(unit.listPrice)),
      );
    if (priced.length > 0) {
      await tx.insert(priceListItem).values(
        priced.map((u) => ({
          organizationId: ctx.orgId,
          priceListId: created.id,
          unitId: u.id,
          price: u.listPrice ?? 0n,
        })),
      );
    }
    return created;
  });
}

/** Replaces all items of a draft. Every unit must belong to the list's project. */
export async function setPriceListItems(ctx: TenantCtx, input: In<typeof setPriceListItemsSchema>) {
  assertCan(ctx, "price:update");
  await withTenant(ctx, async (tx) => {
    const list = await lockDraft(tx, input.priceListId);

    const unitIds = [...new Set(input.items.map((i) => i.unitId))];
    if (unitIds.length !== input.items.length) {
      throw new AppError("VALIDATION", "errors.VALIDATION", {
        details: { reason: "duplicateUnit" },
      });
    }
    if (unitIds.length > 0) {
      const found = await tx
        .select({ id: unit.id })
        .from(unit)
        .where(
          and(
            inArray(unit.id, unitIds),
            eq(unit.projectId, list.projectId),
            isNull(unit.deletedAt),
          ),
        );
      if (found.length !== unitIds.length) {
        throw new AppError("VALIDATION", "inventory.errors.unitNotInProject");
      }
    }

    await tx.delete(priceListItem).where(eq(priceListItem.priceListId, list.id));
    if (input.items.length > 0) {
      await tx.insert(priceListItem).values(
        input.items.map((i) => ({
          organizationId: ctx.orgId,
          priceListId: list.id,
          unitId: i.unitId,
          price: i.price,
        })),
      );
    }
    await tx.update(priceList).set({ updatedAt: new Date() }).where(eq(priceList.id, list.id));
  });
}

/**
 * Applies a draft: every unit whose list price differs takes the new price, with a
 * unit_price_history row each and one audit entry listing the changes. The list becomes read-only.
 */
export async function applyPriceList(ctx: TenantCtx, input: In<typeof priceListIdSchema>) {
  assertCan(ctx, "price:update");
  return withTenant(ctx, async (tx) => {
    const list = await lockDraft(tx, input.priceListId);

    const items = await tx
      .select({
        unitId: unit.id,
        code: unit.code,
        current: unit.listPrice,
        next: priceListItem.price,
      })
      .from(priceListItem)
      .innerJoin(unit, eq(unit.id, priceListItem.unitId))
      .where(and(eq(priceListItem.priceListId, list.id), isNull(unit.deletedAt)))
      .for("update", { of: unit });

    const changes = items.filter((i) => i.current !== i.next);
    for (const change of changes) {
      await tx.update(unit).set({ listPrice: change.next }).where(eq(unit.id, change.unitId));
    }
    if (changes.length > 0) {
      await tx.insert(unitPriceHistory).values(
        changes.map((c) => ({
          organizationId: ctx.orgId,
          unitId: c.unitId,
          oldPrice: c.current,
          newPrice: c.next,
          priceListId: list.id,
          reason: list.name,
          actorUserId: ctx.userId,
        })),
      );
    }

    await tx
      .update(priceList)
      .set({ status: "applied", appliedAt: new Date(), appliedBy: ctx.userId })
      .where(eq(priceList.id, list.id));

    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "price_list.apply",
      entityType: "price_list",
      entityId: list.id,
      after: {
        version: list.version,
        name: list.name,
        changes: changes.map((c) => ({ unit: c.code, from: c.current, to: c.next })),
      },
    });
    return { changed: changes.length };
  });
}

export async function discardPriceList(ctx: TenantCtx, input: In<typeof priceListIdSchema>) {
  assertCan(ctx, "price:update");
  await withTenant(ctx, async (tx) => {
    const list = await lockDraft(tx, input.priceListId);
    await tx.update(priceList).set({ status: "discarded" }).where(eq(priceList.id, list.id));
  });
}
