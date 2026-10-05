/**
 * Deliveries vocabulary (module 4, CLAUDE.md §7): handovers, reserves and the delivery state
 * of a sold unit. Isomorphic: shared by the Drizzle schema, Zod schemas, services and UI.
 */

/** A handover is planned (appointment, reserves being listed), then its PV is signed (final). */
export const handoverStatuses = ["scheduled", "signed"] as const;
export type HandoverStatus = (typeof handoverStatuses)[number];

/** Corps d'état of a reserve. */
export const punchTrades = [
  "masonry",
  "plumbing",
  "electrical",
  "joinery",
  "painting",
  "tiling",
  "waterproofing",
  "other",
] as const;
export type PunchTrade = (typeof punchTrades)[number];

/** A reserve is open until lifted (works done) or cancelled (recorded by mistake, refused). */
export const punchStatuses = ["open", "lifted", "cancelled"] as const;
export type PunchStatus = (typeof punchStatuses)[number];

/** A reserve as printed on the PV de remise des clés. */
export type PrintedReserve = {
  position: number;
  location: string;
  description: string;
  trade: PunchTrade;
};

/**
 * Where the delivery of a sold unit stands (derived, never stored):
 * - `not_ready`: no handover yet and the works are not finished (no validated handover
 *   milestone, project not delivered);
 * - `to_schedule`: ready, no appointment yet;
 * - `scheduled`: an appointment, the PV not signed;
 * - `reserves`: PV signed, reserves still open or lifted without their closing PV;
 * - `delivered`: PV signed without reserves, or every reserve settled and closed.
 */
export const deliveryStates = [
  "not_ready",
  "to_schedule",
  "scheduled",
  "reserves",
  "delivered",
] as const;
export type DeliveryState = (typeof deliveryStates)[number];

export function deliveryState(input: {
  ready: boolean;
  status: HandoverStatus | null;
  openReserves: number;
  liftedReserves: number;
  reservesClosedOn: string | null;
}): DeliveryState {
  if (input.status === null) return input.ready ? "to_schedule" : "not_ready";
  if (input.status === "scheduled") return "scheduled";
  if (input.openReserves > 0) return "reserves";
  if (input.liftedReserves > 0 && input.reservesClosedOn === null) return "reserves";
  return "delivered";
}
