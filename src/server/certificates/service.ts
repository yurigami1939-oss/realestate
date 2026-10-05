import "server-only";

import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { certificate, reservation } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import type { CertificateKind } from "@/lib/certificates";
import { toCalendarDate, todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";
import type { PortalCtx } from "@/server/portal/context";
import { isPortalSale } from "@/server/portal/sales";
import { loadVisibleReservation } from "@/server/sales/access";

import type { issueCertificateSchema, portalStatementSchema } from "./schemas";
import { certificateSnapshot } from "./snapshot";

type IssueInput = z.output<typeof issueCertificateSchema>;

/** Numbers, stores and queues the PDF of a certificate whose snapshot is ready. */
async function insertCertificate(
  tx: Tx,
  scope: { orgId: string; userId: string },
  values: {
    reservationId: string;
    kind: CertificateKind;
    addressee: string | null;
    fromPortal: boolean;
    built: NonNullable<Awaited<ReturnType<typeof certificateSnapshot>>>;
  },
) {
  const { number } = await nextDocumentNumber(tx, scope, "certificate");
  const [row] = await tx
    .insert(certificate)
    .values({
      organizationId: scope.orgId,
      reservationId: values.reservationId,
      kind: values.kind,
      number,
      issuedBy: scope.userId,
      fromPortal: values.fromPortal,
      addressee: values.addressee,
      paid: values.built.paid,
      data: values.built.snapshot,
    })
    .returning({ id: certificate.id });
  if (!row) throw new Error("insertCertificate: no row returned");
  await enqueueInTx(
    tx,
    "pdf.document",
    { organizationId: scope.orgId, kind: "certificate", id: row.id },
    { singletonKey: `certificate:${row.id}` },
  );
  await recordAudit(tx, scope, {
    actorUserId: scope.userId,
    action: "certificate.issue",
    entityType: "reservation",
    entityId: values.reservationId,
    after: {
      number,
      kind: values.kind,
      addressee: values.addressee,
      fromPortal: values.fromPortal,
      paid: values.built.paid,
      remaining: values.built.remaining,
    },
  });
  return { id: row.id, number };
}

/**
 * Issues a certificate on a sale (CLAUDE.md §7 Certificates): numbered `ATT-` in the
 * transaction, what it prints frozen, the bilingual PDF rendered by the worker, filed under
 * the sale; audited `certificate.issue`. An attestation de versements needs a payment; an
 * attestation de paiement intégral needs nothing left to pay and no cheque awaiting clearance.
 */
export async function issueCertificate(ctx: TenantCtx, input: IssueInput) {
  assertCan(ctx, "sale:certify");
  return withTenant(ctx, async (tx) => {
    const sale = await loadVisibleReservation(tx, ctx, input.reservationId, { forUpdate: true });
    if (sale.status === "withdrawn") throw new AppError("CONFLICT", "sales.errors.closed");
    const built = await certificateSnapshot(tx, sale.id, { publishedOnly: false });
    if (!built) throw new AppError("CONFLICT", "sales.errors.closed");
    if (input.kind === "payments" && built.paid === 0n) {
      throw new AppError("CONFLICT", "certificates.errors.nothingPaid");
    }
    if (input.kind === "paid_in_full") {
      if (built.remaining > 0n) throw new AppError("CONFLICT", "certificates.errors.notPaidInFull");
      if (built.snapshot.payments.some((p) => p.pendingCheque)) {
        throw new AppError("CONFLICT", "certificates.errors.chequePending");
      }
    }
    return insertCertificate(tx, ctx, {
      reservationId: sale.id,
      kind: input.kind,
      addressee: input.addressee,
      fromPortal: false,
      built,
    });
  });
}

/**
 * Portal: the buyer's own statement of account (relevé, unsigned), with the progress of
 * published reports only. The one drawn earlier the same day is served again while nothing
 * was paid or cancelled since.
 */
export async function issuePortalStatement(
  ctx: PortalCtx,
  input: z.output<typeof portalStatementSchema>,
) {
  return withTenant(ctx, async (tx) => {
    if (!(await isPortalSale(tx, ctx.userId, input.reservationId))) {
      throw new AppError("NOT_FOUND");
    }
    await tx
      .select({ id: reservation.id })
      .from(reservation)
      .where(eq(reservation.id, input.reservationId))
      .for("update");
    const built = await certificateSnapshot(tx, input.reservationId, { publishedOnly: true });
    if (!built) throw new AppError("NOT_FOUND");
    const [last] = await tx
      .select({
        id: certificate.id,
        number: certificate.number,
        issuedAt: certificate.issuedAt,
        paid: certificate.paid,
      })
      .from(certificate)
      .where(
        and(
          eq(certificate.reservationId, input.reservationId),
          eq(certificate.kind, "statement"),
          eq(certificate.fromPortal, true),
        ),
      )
      .orderBy(desc(certificate.issuedAt))
      .limit(1);
    if (last && toCalendarDate(last.issuedAt) === todayInAlgiers() && last.paid === built.paid) {
      return { id: last.id, number: last.number, reused: true };
    }
    const issued = await insertCertificate(tx, ctx, {
      reservationId: input.reservationId,
      kind: "statement",
      addressee: null,
      fromPortal: true,
      built,
    });
    return { ...issued, reused: false };
  });
}
