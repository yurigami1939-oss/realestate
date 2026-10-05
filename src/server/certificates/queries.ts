import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { certificate, reservation, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { visibleSales } from "@/server/sales/access";

/** Certificates of a visible sale, latest first (staff and portal ones). */
export async function listSaleCertificates(ctx: TenantCtx, reservationId: string) {
  assertCan(ctx, "sale:read");
  if (!isUuid(reservationId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: certificate.id,
        kind: certificate.kind,
        number: certificate.number,
        issuedAt: certificate.issuedAt,
        addressee: certificate.addressee,
        fromPortal: certificate.fromPortal,
        pdfFileId: certificate.pdfFileId,
        issuedByName: user.name,
      })
      .from(certificate)
      .innerJoin(reservation, eq(reservation.id, certificate.reservationId))
      .innerJoin(user, eq(user.id, certificate.issuedBy))
      .where(and(eq(certificate.reservationId, reservationId), visibleSales(ctx)))
      .orderBy(desc(certificate.issuedAt)),
  );
}

export type SaleCertificateRow = Awaited<ReturnType<typeof listSaleCertificates>>[number];
