import "server-only";

import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { buyer, buyerDocument } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import type { BuyerDocumentKind } from "@/lib/sales";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadVisibleLead } from "@/server/crm/access";
import { checkUpload, discardFile, storeFile, type Upload } from "@/server/files/service";

import { loadVisibleBuyer } from "./access";
import type { createBuyerSchema, setBuyerDocumentSchema, updateBuyerSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const ninTaken = () =>
  new AppError("CONFLICT", "buyers.errors.ninTaken", {
    fieldErrors: { nin: ["buyers.errors.ninTaken"] },
  });

async function uniqueNin<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw ninTaken();
    throw error;
  }
}

/**
 * Creates a buyer file, usually from a lead: the buyer is then followed by the lead's
 * commercial. A commercial can only start from a lead they own.
 */
export async function createBuyer(ctx: TenantCtx, input: In<typeof createBuyerSchema>) {
  assertCan(ctx, "buyer:create");
  return withTenant(ctx, async (tx) => {
    const { leadId, ...fields } = input;
    const lead = leadId ? await loadVisibleLead(tx, ctx, leadId) : null;
    const [row] = await uniqueNin(() =>
      tx
        .insert(buyer)
        .values({
          ...fields,
          organizationId: ctx.orgId,
          leadId,
          ownerUserId: lead?.assignedTo ?? ctx.userId,
          createdBy: ctx.userId,
        })
        .returning({ id: buyer.id }),
    );
    if (!row) throw new Error("createBuyer: no row returned");
    return { id: row.id };
  });
}

export async function updateBuyer(ctx: TenantCtx, input: In<typeof updateBuyerSchema>) {
  assertCan(ctx, "buyer:update");
  await withTenant(ctx, async (tx) => {
    const { buyerId, ...fields } = input;
    await loadVisibleBuyer(tx, ctx, buyerId, { forUpdate: true });
    await uniqueNin(() => tx.update(buyer).set(fields).where(eq(buyer.id, buyerId)));
  });
}

async function upsertDocument(
  tx: Tx,
  ctx: TenantCtx,
  buyerId: string,
  kind: BuyerDocumentKind,
  values: Partial<Pick<typeof buyerDocument.$inferInsert, "status" | "note" | "fileId">>,
) {
  await tx
    .insert(buyerDocument)
    .values({ organizationId: ctx.orgId, buyerId, kind, updatedBy: ctx.userId, ...values })
    .onConflictDoUpdate({
      target: [buyerDocument.buyerId, buyerDocument.kind],
      set: { ...values, updatedBy: ctx.userId, updatedAt: new Date() },
    });
}

/** Checklist status of one document (missing / received / verified) with a note. */
export async function setBuyerDocument(ctx: TenantCtx, input: In<typeof setBuyerDocumentSchema>) {
  assertCan(ctx, "buyer:update");
  await withTenant(ctx, async (tx) => {
    await loadVisibleBuyer(tx, ctx, input.buyerId, { forUpdate: true });
    await upsertDocument(tx, ctx, input.buyerId, input.kind, {
      status: input.status,
      note: input.note,
    });
  });
}

/** Stores the scan of a document (PDF or image); a new scan needs verifying again ("received"). */
export async function setBuyerDocumentScan(
  ctx: TenantCtx,
  input: { buyerId: string; kind: BuyerDocumentKind; upload: Upload },
) {
  assertCan(ctx, "buyer:update");
  const contentType = checkUpload("buyer.document", input.upload);
  return withTenant(ctx, async (tx) => {
    await loadVisibleBuyer(tx, ctx, input.buyerId, { forUpdate: true });
    const [current] = await tx
      .select({ fileId: buyerDocument.fileId })
      .from(buyerDocument)
      .where(and(eq(buyerDocument.buyerId, input.buyerId), eq(buyerDocument.kind, input.kind)));
    const stored = await storeFile(tx, ctx, {
      entityType: "buyer",
      entityId: input.buyerId,
      upload: input.upload,
      contentType,
    });
    await upsertDocument(tx, ctx, input.buyerId, input.kind, {
      fileId: stored.id,
      status: "received",
    });
    if (current?.fileId) await discardFile(tx, current.fileId);
    return { fileId: stored.id };
  });
}
