/**
 * Sales vocabulary (CLAUDE.md §6) and the defaults of the sales settings (§12). Isomorphic:
 * shared by the Drizzle schema, Zod schemas, services and UI.
 */

export const civilities = ["mr", "mrs"] as const;
export type Civility = (typeof civilities)[number];

export const maritalStatuses = ["single", "married", "divorced", "widowed"] as const;
export type MaritalStatus = (typeof maritalStatuses)[number];

/** Pièces du dossier acquéreur. */
export const buyerDocumentKinds = [
  "id_card",
  "birth_certificate",
  "family_record",
  "residence_certificate",
  "employment_certificate",
  "payslips",
  "bank_statement",
  "other",
] as const;
export type BuyerDocumentKind = (typeof buyerDocumentKinds)[number];

/** Expected in every file; missing ones are highlighted, never blocking (CLAUDE.md §12). */
export const requiredBuyerDocuments = [
  "id_card",
  "birth_certificate",
  "family_record",
  "residence_certificate",
  "employment_certificate",
  "payslips",
] as const satisfies readonly BuyerDocumentKind[];

export const documentStatuses = ["missing", "received", "verified"] as const;
export type DocumentStatus = (typeof documentStatuses)[number];

export const optionStatuses = ["active", "expired", "cancelled", "converted"] as const;
export type OptionStatus = (typeof optionStatuses)[number];

export const paymentMethods = ["cash", "cheque", "bank_transfer", "ccp", "bank_loan"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

/** Construction stages used to check VSP payment limits (a milestone may have one). */
export const constructionStages = ["foundations", "structure", "completion", "handover"] as const;
export type ConstructionStage = (typeof constructionStages)[number];

/** Stages with a configurable cumulative limit, in order; handover = 100 %. */
export const vspLimitStages = ["signing", "foundations", "structure", "completion"] as const;
export type VspLimitStage = (typeof vspLimitStages)[number];
/** Cumulative share (basis points) that may be collected up to each stage; missing = no check. */
export type VspLimits = Partial<Record<VspLimitStage, number>>;

/** Defaults until the gérant saves the company settings (CLAUDE.md §12). */
export const salesSettingDefaults = {
  optionHours: 24,
  paymentCallDelayDays: 15,
  withdrawalRetentionBp: 1_000,
  penaltyMonthlyRateBp: 0,
  penaltyGraceDays: 0,
  penaltyCapBp: 1_000,
  defaultCommissionRateBp: 0,
} as const;

export type SalesSettings = { [K in keyof typeof salesSettingDefaults]: number } & {
  vspLimits: VspLimits;
};

export const reservationStatuses = ["reserved", "sold", "withdrawn"] as const;
export type ReservationStatus = (typeof reservationStatuses)[number];

export const commissionStatuses = ["earned", "paid", "cancelled"] as const;
export type CommissionStatus = (typeof commissionStatuses)[number];

/** A reservation has 1 to 3 buyers (co-acquéreurs, e.g. spouses); the first is the main one. */
export const MAX_BUYERS_PER_SALE = 3;
