import "server-only";

import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  eSignature,
  file,
  lease,
  leaseInspection,
  reservation,
  scheduleAmendment,
  signatureCode,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { env } from "@/env";
import { enqueueInTx } from "@/jobs/enqueue";
import { AppError } from "@/lib/result";
import {
  maskEmail,
  SIGNATURE_CODE_MINUTES,
  SIGNATURE_CODE_TRIES,
  SIGNATURE_CODES_PER_HOUR,
  type SignableDocument,
} from "@/lib/signatures";
import { recordAudit } from "@/server/audit/record-audit";
import { signatureCodeEmail } from "@/server/email/templates";
import { getObjectBytes } from "@/server/files/storage";
import type { PortalCtx } from "@/server/portal/context";
import { isPortalLease } from "@/server/portal/leases";
import { isPortalSale } from "@/server/portal/sales";
import { companyName } from "@/server/whatsapp/account";

import type { requestSignatureCodeSchema, signDocumentSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** A document this portal account may sign, with its stored PDF and what it belongs to. */
type Signable = {
  fileId: string | null;
  storageKey: string | null;
  /** What names it in the code's e-mail. */
  number: string;
  reference: string;
  kind: string;
  /** The record its signatures are audited on. */
  entity: { type: "reservation" | "lease"; id: string };
};

/**
 * The document when the account may sign it: an avenant of one of its sales, an inspection
 * report of one of its leases (CLAUDE.md §7 Electronic signature). Null otherwise.
 */
async function loadSignable(
  tx: Tx,
  ctx: PortalCtx,
  type: SignableDocument,
  id: string,
): Promise<Signable | null> {
  switch (type) {
    case "schedule_amendment": {
      const [row] = await tx
        .select({
          reservationId: scheduleAmendment.reservationId,
          sequence: scheduleAmendment.sequence,
          saleNumber: reservation.number,
          fileId: scheduleAmendment.pdfFileId,
          storageKey: file.storageKey,
        })
        .from(scheduleAmendment)
        .innerJoin(reservation, eq(reservation.id, scheduleAmendment.reservationId))
        .leftJoin(file, eq(file.id, scheduleAmendment.pdfFileId))
        .where(eq(scheduleAmendment.id, id));
      if (!row || !(await isPortalSale(tx, ctx.userId, row.reservationId))) return null;
      return {
        fileId: row.fileId,
        storageKey: row.storageKey,
        number: String(row.sequence),
        reference: row.saleNumber,
        kind: "",
        entity: { type: "reservation", id: row.reservationId },
      };
    }
    case "lease_inspection": {
      const [row] = await tx
        .select({
          leaseId: leaseInspection.leaseId,
          kind: leaseInspection.kind,
          leaseNumber: lease.number,
          fileId: leaseInspection.pdfFileId,
          storageKey: file.storageKey,
        })
        .from(leaseInspection)
        .innerJoin(lease, eq(lease.id, leaseInspection.leaseId))
        .leftJoin(file, eq(file.id, leaseInspection.pdfFileId))
        .where(eq(leaseInspection.id, id));
      if (!row || !(await isPortalLease(tx, ctx.userId, row.leaseId))) return null;
      return {
        fileId: row.fileId,
        storageKey: row.storageKey,
        number: "",
        reference: row.leaseNumber,
        kind: row.kind,
        entity: { type: "lease", id: row.leaseId },
      };
    }
  }
}

async function signedBy(tx: Tx, userId: string, type: SignableDocument, id: string) {
  const [row] = await tx
    .select({ id: eSignature.id })
    .from(eSignature)
    .where(
      and(
        eq(eSignature.documentType, type),
        eq(eSignature.documentId, id),
        eq(eSignature.signerUserId, userId),
      ),
    );
  return row !== undefined;
}

/** The code's fingerprint: keyed with the server's secret, tied to the account and document. */
const codeHash = (userId: string, documentId: string, code: string) =>
  createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`signature:${userId}:${documentId}:${code}`)
    .digest("hex");

const hashesEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Sends the account a one-time code to sign a document (e-mailed to its address, French then
 * Arabic): six digits, valid a few minutes, a few codes per hour. Returns where it went.
 */
export async function requestSignatureCode(
  ctx: PortalCtx,
  input: In<typeof requestSignatureCodeSchema>,
) {
  return withTenant(ctx, async (tx) => {
    const doc = await loadSignable(tx, ctx, input.documentType, input.documentId);
    if (!doc) throw new AppError("NOT_FOUND");
    if (!doc.fileId) throw new AppError("CONFLICT", "signatures.errors.noPdf");
    if (await signedBy(tx, ctx.userId, input.documentType, input.documentId)) {
      throw new AppError("CONFLICT", "signatures.errors.alreadySigned");
    }
    const [recent] = await tx
      .select({ n: count() })
      .from(signatureCode)
      .where(
        and(
          eq(signatureCode.userId, ctx.userId),
          eq(signatureCode.documentId, input.documentId),
          gt(signatureCode.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      );
    if ((recent?.n ?? 0) >= SIGNATURE_CODES_PER_HOUR) {
      throw new AppError("CONFLICT", "signatures.errors.tooManyCodes");
    }
    // `user` is Better Auth's table: the account's own row.
    const [account] = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, ctx.userId));
    if (!account) throw new AppError("NOT_FOUND");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + SIGNATURE_CODE_MINUTES * 60_000);
    await tx.insert(signatureCode).values({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      documentType: input.documentType,
      documentId: input.documentId,
      codeHash: codeHash(ctx.userId, input.documentId, code),
      expiresAt,
    });
    await enqueueInTx(
      tx,
      "email.send",
      signatureCodeEmail({
        to: account.email,
        code,
        document: {
          type: input.documentType,
          number: doc.number,
          reference: doc.reference,
          kind: doc.kind,
        },
        organization: await companyName(tx, ctx.orgId),
        minutes: SIGNATURE_CODE_MINUTES,
      }),
    );
    return { email: maskEmail(account.email), expiresAt };
  });
}

/**
 * Signs the document with the code received (CLAUDE.md §7 Electronic signature): the latest
 * code still valid, a few tries; then the signature is kept with the SHA-256 of the stored PDF,
 * the time, the address and the browser — append-only, audited on the sale or the lease.
 */
export async function signDocument(
  ctx: PortalCtx,
  input: In<typeof signDocumentSchema>,
  client: { ip: string | null; userAgent: string | null },
) {
  const doc = await withTenant(ctx, (tx) =>
    loadSignable(tx, ctx, input.documentType, input.documentId),
  );
  if (!doc) throw new AppError("NOT_FOUND");
  if (!doc.fileId || !doc.storageKey) throw new AppError("CONFLICT", "signatures.errors.noPdf");
  const fileId = doc.fileId;
  // The fingerprint of the PDF as stored (read outside the transaction).
  const sha256 = createHash("sha256")
    .update(await getObjectBytes(doc.storageKey))
    .digest("hex");

  const outcome = await withTenant(ctx, async (tx) => {
    if (await signedBy(tx, ctx.userId, input.documentType, input.documentId)) {
      throw new AppError("CONFLICT", "signatures.errors.alreadySigned");
    }
    const [challenge] = await tx
      .select()
      .from(signatureCode)
      .where(
        and(
          eq(signatureCode.userId, ctx.userId),
          eq(signatureCode.documentType, input.documentType),
          eq(signatureCode.documentId, input.documentId),
          isNull(signatureCode.usedAt),
          gt(signatureCode.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(signatureCode.createdAt))
      .limit(1)
      .for("update");
    if (!challenge) return "signatures.errors.codeExpired";
    if (challenge.attempts >= SIGNATURE_CODE_TRIES) return "signatures.errors.codeLocked";
    if (!hashesEqual(codeHash(ctx.userId, input.documentId, input.code), challenge.codeHash)) {
      // Kept: the transaction commits the failed try.
      await tx
        .update(signatureCode)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(signatureCode.id, challenge.id));
      return "signatures.errors.wrongCode";
    }
    await tx
      .update(signatureCode)
      .set({ usedAt: new Date() })
      .where(eq(signatureCode.id, challenge.id));
    const [account] = await tx
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, ctx.userId));
    const [row] = await tx
      .insert(eSignature)
      .values({
        organizationId: ctx.orgId,
        documentType: input.documentType,
        documentId: input.documentId,
        fileId,
        documentSha256: sha256,
        signerUserId: ctx.userId,
        signerName: account?.name ?? ctx.name,
        signerEmail: account?.email ?? "",
        ipAddress: client.ip,
        userAgent: client.userAgent?.slice(0, 300) ?? null,
      })
      .returning({ id: eSignature.id, signedAt: eSignature.signedAt });
    if (!row) throw new Error("signDocument: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "e_signature.sign",
      entityType: doc.entity.type,
      entityId: doc.entity.id,
      after: {
        document: input.documentType,
        documentId: input.documentId,
        sha256,
        signer: account?.name ?? ctx.name,
      },
    });
    return { id: row.id, signedAt: row.signedAt, sha256 };
  });
  if (typeof outcome === "string") {
    throw new AppError("VALIDATION", outcome, { fieldErrors: { code: [outcome] } });
  }
  return outcome;
}
