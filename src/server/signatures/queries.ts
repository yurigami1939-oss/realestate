import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { eSignature } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { SignableDocument } from "@/lib/signatures";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import type { PortalCtx } from "@/server/portal/context";

export type DocumentSignature = {
  signerName: string;
  signedAt: Date;
  documentSha256: string;
  ipAddress: string | null;
};

/** Who signed which of these documents (staff: a sale's avenants, a lease's reports). */
export async function listSignatures(
  ctx: TenantCtx,
  type: SignableDocument,
  documentIds: string[],
): Promise<Map<string, DocumentSignature[]>> {
  assertCan(ctx, type === "schedule_amendment" ? "sale:read" : "lease:read");
  const signatures = new Map<string, DocumentSignature[]>();
  if (documentIds.length === 0) return signatures;
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({
        documentId: eSignature.documentId,
        signerName: eSignature.signerName,
        signedAt: eSignature.signedAt,
        documentSha256: eSignature.documentSha256,
        ipAddress: eSignature.ipAddress,
      })
      .from(eSignature)
      .where(and(eq(eSignature.documentType, type), inArray(eSignature.documentId, documentIds)))
      .orderBy(asc(eSignature.signedAt)),
  );
  for (const { documentId, ...signature } of rows) {
    signatures.set(documentId, [...(signatures.get(documentId) ?? []), signature]);
  }
  return signatures;
}

/** When this portal account signed each of these documents. */
export async function listMySignatures(
  ctx: PortalCtx,
  type: SignableDocument,
  documentIds: string[],
): Promise<Map<string, Date>> {
  if (documentIds.length === 0) return new Map();
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({ documentId: eSignature.documentId, signedAt: eSignature.signedAt })
      .from(eSignature)
      .where(
        and(
          eq(eSignature.documentType, type),
          inArray(eSignature.documentId, documentIds),
          eq(eSignature.signerUserId, ctx.userId),
        ),
      ),
  );
  return new Map(rows.map((r) => [r.documentId, r.signedAt]));
}
