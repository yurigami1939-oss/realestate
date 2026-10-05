/**
 * Isomorphic: the certificates (attestations) issued on a sale for its buyers and their banks
 * (CLAUDE.md §7 Certificates).
 */

/**
 * `reservation`: attestation de réservation (the unit, the contract, the price; the VSP once
 * signed) · `payments`: attestation de versements (what was paid, payment by payment, and what
 * remains) · `paid_in_full`: attestation de paiement intégral (nothing remains) · `progress`:
 * attestation d'avancement des travaux (the building's progress, the milestones reached) ·
 * `statement`: relevé de compte (schedule, payments, balance; not an attestation).
 */
export const certificateKinds = [
  "reservation",
  "payments",
  "paid_in_full",
  "progress",
  "statement",
] as const;
export type CertificateKind = (typeof certificateKinds)[number];

/** What a buyer may draw from the portal by themselves (it bears no signature). */
export const portalCertificateKinds = ["statement"] as const satisfies readonly CertificateKind[];

/** Printed state of a schedule line (as on the sale page). */
export type CertificateLineState = "paid" | "overdue" | "due" | "upcoming" | "pending";

/**
 * Everything printed on a certificate, frozen at issue (amounts as decimal strings of
 * centimes): later payments or corrections never change an issued certificate.
 */
export type CertificateSnapshot = {
  buyers: {
    name: string;
    nameAr: string | null;
    nin: string | null;
    birthDate: string | null;
    birthPlace: string | null;
  }[];
  sale: {
    number: string;
    reservedOn: string;
    status: "reserved" | "sold";
    price: string;
    reservationNotary: string | null;
    reservationReference: string | null;
    saleNumber: string | null;
    saleSignedOn: string | null;
    saleNotary: string | null;
  };
  unit: {
    code: string;
    type: string;
    typology: string | null;
    floor: number;
    building: string;
    livingArea: string | null;
    usableArea: string | null;
  };
  project: { name: string; address: string | null; commune: string | null; wilaya: string | null };
  totals: { paid: string; remaining: string; due: string; overdue: string };
  installments: {
    label: string;
    dueOn: string | null;
    amount: string;
    paid: string;
    remaining: string;
    state: CertificateLineState;
  }[];
  payments: {
    paidOn: string;
    method: string;
    reference: string | null;
    bank: string | null;
    amount: string;
    receipt: string | null;
    /** A cheque not yet cleared by the bank (« sous réserve d'encaissement »). */
    pendingCheque: boolean;
  }[];
  progress: {
    percent: number | null;
    reportedOn: string | null;
    milestones: { name: string; plannedOn: string | null; validatedOn: string | null }[];
  };
};
