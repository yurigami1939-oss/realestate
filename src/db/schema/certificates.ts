import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { type CertificateSnapshot, certificateKinds } from "../../lib/certificates";

import { id, instant, money, organizationId, userRef } from "./_columns";
import { file } from "./files";
import { reservation } from "./sales";

export const certificateKind = pgEnum("certificate_kind", certificateKinds);

/**
 * A certificate issued on a sale (attestation de réservation, de versements, de paiement
 * intégral, d'avancement des travaux, relevé de compte), numbered `ATT-`, with everything it
 * prints frozen at issue. Immutable (grants): only its PDF link is set by the job.
 */
export const certificate = pgTable(
  "certificate",
  {
    id: id(),
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    kind: certificateKind().notNull(),
    number: text().notNull(),
    issuedAt: instant().notNull().defaultNow(),
    issuedBy: userRef().notNull(),
    /** Drawn by the buyer from the portal (a relevé, unsigned). */
    fromPortal: boolean().notNull().default(false),
    /** « À l'attention de … » (a bank, an administration); null = « à qui de droit ». */
    addressee: text(),
    /** Total paid when issued (a portal relevé of the same day and total is served again). */
    paid: money().notNull(),
    data: jsonb().$type<CertificateSnapshot>().notNull(),
    pdfFileId: uuid(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("certificate_number_unique").on(t.organizationId, t.number),
    foreignKey({
      name: "certificate_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    foreignKey({
      name: "certificate_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.reservationId),
  ],
);
