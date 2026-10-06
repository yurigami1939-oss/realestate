import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { buyer, buyerDocument } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { type BuyerDocumentKind, buyerDocumentKinds, requiredBuyerDocuments } from "@/lib/sales";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { checkUpload, discardFile, storeFile, type Upload } from "@/server/files/service";

import type { PortalCtx } from "./context";
import { portalScope } from "./context";

/**
 * The buyer files of a portal account with their documents checklist (CLAUDE.md §7 Portal):
 * the required pieces and any other already received, each with its status and scan.
 */
export async function listPortalBuyerDocuments(ctx: PortalCtx) {
  return withTenant(ctx, async (tx) => {
    const { buyerIds } = await portalScope(tx, ctx);
    if (buyerIds.length === 0) return [];
    const buyers = await tx
      .select({ id: buyer.id, lastName: buyer.lastName, firstName: buyer.firstName })
      .from(buyer)
      .where(inArray(buyer.id, buyerIds))
      .orderBy(asc(buyer.lastName), asc(buyer.firstName));
    const documents = await tx
      .select({
        buyerId: buyerDocument.buyerId,
        kind: buyerDocument.kind,
        status: buyerDocument.status,
        fileId: buyerDocument.fileId,
        submittedFromPortal: buyerDocument.submittedFromPortal,
      })
      .from(buyerDocument)
      .where(inArray(buyerDocument.buyerId, buyerIds));
    return buyers.map((b) => ({
      ...b,
      documents: buyerDocumentKinds.flatMap((kind) => {
        const found = documents.find((d) => d.buyerId === b.id && d.kind === kind);
        const required = (requiredBuyerDocuments as readonly BuyerDocumentKind[]).includes(kind);
        if (!found && !required) return [];
        return [
          {
            kind,
            required,
            status: found?.status ?? "missing",
            fileId: found?.fileId ?? null,
            submittedFromPortal: found?.submittedFromPortal ?? false,
          },
        ];
      }),
    }));
  });
}

export type PortalBuyerDocuments = Awaited<ReturnType<typeof listPortalBuyerDocuments>>;

/**
 * A buyer sends a document of their own file from the portal: stored under the buyer, the
 * piece becomes « received » and waits for staff to verify it (dashboard). A verified piece is
 * no longer replaced from the portal. Audited.
 */
export async function uploadPortalBuyerDocument(
  ctx: PortalCtx,
  input: { buyerId: string; kind: BuyerDocumentKind; upload: Upload },
) {
  const contentType = checkUpload("portal.buyer_document", input.upload);
  return withTenant(ctx, async (tx) => {
    const { buyerIds } = await portalScope(tx, ctx);
    if (!buyerIds.includes(input.buyerId)) throw new AppError("NOT_FOUND");
    const [current] = await tx
      .select({ status: buyerDocument.status, fileId: buyerDocument.fileId })
      .from(buyerDocument)
      .where(and(eq(buyerDocument.buyerId, input.buyerId), eq(buyerDocument.kind, input.kind)))
      .for("update");
    if (current?.status === "verified") {
      throw new AppError("CONFLICT", "portal.documents.errors.verified");
    }
    const stored = await storeFile(tx, ctx, {
      entityType: "buyer",
      entityId: input.buyerId,
      upload: input.upload,
      contentType,
    });
    const values = {
      status: "received" as const,
      fileId: stored.id,
      submittedFromPortal: true,
      updatedBy: ctx.userId,
    };
    await tx
      .insert(buyerDocument)
      .values({ organizationId: ctx.orgId, buyerId: input.buyerId, kind: input.kind, ...values })
      .onConflictDoUpdate({
        target: [buyerDocument.buyerId, buyerDocument.kind],
        set: { ...values, updatedAt: new Date() },
      });
    if (current?.fileId) await discardFile(tx, current.fileId);
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "buyer_document.portal_upload",
      entityType: "buyer",
      entityId: input.buyerId,
      after: { kind: input.kind, fileId: stored.id },
    });
    return { fileId: stored.id };
  });
}
