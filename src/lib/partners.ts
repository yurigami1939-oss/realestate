/**
 * Outside agencies and business introducers who bring buyers (CLAUDE.md §7 CRM): a lead names
 * the partner who brought it; the partner's commission is earned at the VSP. Isomorphic.
 */
export const partnerKinds = ["agency", "introducer"] as const;
export type PartnerKind = (typeof partnerKinds)[number];
