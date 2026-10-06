/**
 * Requests buyers send from the portal about their sale (CLAUDE.md §7 Portal): an attestation
 * to issue, an appointment, or anything else; staff answer them. Isomorphic.
 */
import type { CertificateKind } from "./certificates";

export const portalRequestKinds = ["certificate", "appointment", "other"] as const;
export type PortalRequestKind = (typeof portalRequestKinds)[number];

export const portalRequestStatuses = ["open", "done", "declined"] as const;
export type PortalRequestStatus = (typeof portalRequestStatuses)[number];

/** Attestations a buyer can ask for (staff sign them; the relevé is drawn on the portal). */
export const requestableCertificates = [
  "reservation",
  "payments",
  "paid_in_full",
  "progress",
] as const satisfies readonly CertificateKind[];
export type RequestableCertificate = (typeof requestableCertificates)[number];
