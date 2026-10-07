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

/**
 * How a charge category is split over the units: by tantièmes, equally, over the units of one
 * building, or over an explicit list of units (CLAUDE.md §7 Residence charges).
 */
/** `consumption`: by each unit's water consumption between its two latest meter readings. */
export const distributionKeys = [
  "share",
  "equal",
  "per_building",
  "custom",
  "consumption",
] as const;
export type DistributionKey = (typeof distributionKeys)[number];

/** Weight of each unit for the `per_building` and `custom` keys. */
export const distributionWeightings = ["share", "equal"] as const;
export type DistributionWeighting = (typeof distributionWeightings)[number];

/** How a co-owner pays charges (the sales methods without bank loan disbursements). */
export const chargePaymentMethods = ["cash", "cheque", "bank_transfer", "ccp"] as const;
export type ChargePaymentMethod = (typeof chargePaymentMethods)[number];

/** A budget is prepared as a draft, then approved: calls are issued from approved budgets. */
export const budgetStatuses = ["draft", "approved"] as const;
export type BudgetStatus = (typeof budgetStatuses)[number];

/** Jobs of residence staff (agent de sécurité, femme de ménage…). */
export const staffRoles = [
  "security",
  "cleaning",
  "maintenance",
  "gardener",
  "concierge",
  "other",
] as const;
export type StaffRole = (typeof staffRoles)[number];

/** Attendance marks of a day; a day without mark is worked (present). */
export const attendanceStatuses = ["absent", "leave", "sick", "off"] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];
