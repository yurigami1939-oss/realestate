/**
 * CRM vocabulary (CLAUDE.md §6) and pipeline rules (§12: one fixed stage list). Isomorphic:
 * shared by the Drizzle schema, Zod schemas, services and UI.
 */

export const leadSources = [
  "facebook",
  "instagram",
  "whatsapp",
  "ouedkniss",
  "walk_in",
  "referral",
  "phone",
  "website",
  "other",
] as const;
export type LeadSource = (typeof leadSources)[number];

/** Pipeline order. `won` and `lost` close the lead. */
export const leadStages = [
  "new",
  "contacted",
  "visit_scheduled",
  "visited",
  "negotiation",
  "won",
  "lost",
] as const;
export type LeadStage = (typeof leadStages)[number];

export const openLeadStages = leadStages.filter(
  (s): s is Exclude<LeadStage, "won" | "lost"> => s !== "won" && s !== "lost",
);

export const lostReasons = [
  "price",
  "financing",
  "location",
  "typology",
  "delivery_date",
  "competitor",
  "no_response",
  "other",
] as const;
export type LostReason = (typeof lostReasons)[number];

export const financingModes = ["cash", "bank_loan", "mixed", "unknown"] as const;
export type FinancingMode = (typeof financingModes)[number];

export const visitStatuses = ["planned", "done", "cancelled", "no_show"] as const;
export type VisitStatus = (typeof visitStatuses)[number];

export const followUpChannels = ["call", "whatsapp", "sms", "email", "meeting", "other"] as const;
export type FollowUpChannel = (typeof followUpChannels)[number];

export const leadActivityTypes = [
  "created",
  "updated",
  "stage_changed",
  "assigned",
  "note",
  "visit_scheduled",
  "visit_updated",
  "follow_up_created",
  "follow_up_done",
  "quotation_issued",
  "quotation_cancelled",
  "merged",
] as const;
export type LeadActivityType = (typeof leadActivityTypes)[number];

export const isClosedStage = (stage: LeadStage) => stage === "won" || stage === "lost";

/**
 * Stage reached automatically after an event (visit planned, visit done, quotation issued):
 * the lead only moves forward, and closed leads stay closed.
 */
export function advanceStage(current: LeadStage, reached: LeadStage): LeadStage {
  if (isClosedStage(current)) return current;
  return leadStages.indexOf(reached) > leadStages.indexOf(current) ? reached : current;
}
