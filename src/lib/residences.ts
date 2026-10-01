/**
 * Residence management vocabulary (module 6, CLAUDE.md §6–§7, §12). Isomorphic: shared by
 * the schema, the forms and the services.
 */

/** How often charge provisions are called from the annual budget (set per residence). */
export const chargeFrequencies = ["monthly", "quarterly", "half_yearly", "yearly"] as const;
export type ChargeFrequency = (typeof chargeFrequencies)[number];

/** Calls per year for each frequency. */
export const callsPerYear: Record<ChargeFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  half_yearly: 2,
  yearly: 1,
};

/** Copropriétaire / occupant — `co_owner`, not `owner` (the role name, CLAUDE.md §12). */
export const residentKinds = ["co_owner", "occupant"] as const;
export type ResidentKind = (typeof residentKinds)[number];

/** Tantièmes are integers on a basis set per residence (e.g. 10 000). */
export const DEFAULT_SHARE_BASIS = 10_000;
export const MAX_SHARE_BASIS = 1_000_000;
