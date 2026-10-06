/**
 * Inventory vocabulary (CLAUDE.md §6) and the unit status machine (§7). Isomorphic:
 * shared by the Drizzle schema, Zod schemas, services and UI.
 */

export const projectStatuses = ["planning", "under_construction", "delivered"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const unitTypes = [
  "apartment",
  "commercial",
  "office",
  "parking",
  "storage",
  "villa",
] as const;
export type UnitType = (typeof unitTypes)[number];

export const typologies = ["F1", "F2", "F3", "F4", "F5", "F6"] as const;
export type Typology = (typeof typologies)[number];

export const orientations = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Orientation = (typeof orientations)[number];

export const unitStatuses = [
  "available",
  "optioned",
  "reserved",
  "sold",
  "delivered",
  "rented",
  "blocked",
] as const;
export type UnitStatus = (typeof unitStatuses)[number];

/**
 * Allowed transitions. Anything else is INVALID_TRANSITION. `delivered` is terminal; it comes
 * from a handover PV (sold → delivered) or, for a unit sold before the app in a delivered
 * project, from `recordPastDeliveries` (available / blocked → delivered). A unit the company
 * kept (blocked) can be leased directly (blocked → rented); the end of its lease makes it
 * available. A sold unit is available again only when its sale is terminated for non-payment.
 */
export const unitTransitions: Record<UnitStatus, readonly UnitStatus[]> = {
  available: ["optioned", "reserved", "blocked", "rented", "delivered"],
  optioned: ["available", "reserved"],
  reserved: ["available", "sold"],
  sold: ["delivered", "available"],
  delivered: [],
  rented: ["available"],
  blocked: ["available", "delivered", "rented"],
};

export function canTransition(from: UnitStatus, to: UnitStatus): boolean {
  return unitTransitions[from].includes(to);
}

/** Floor label used in unit codes: 0 → "00", 3 → "03", -1 → "S1". */
export function floorCode(floor: number): string {
  return floor < 0 ? `S${-floor}` : String(floor).padStart(2, "0");
}

/** Default unit code: building, floor, position — "A-03-02". */
export function defaultUnitCode(buildingCode: string, floor: number, position: number): string {
  return `${buildingCode}-${floorCode(floor)}-${String(position).padStart(2, "0")}`;
}

export const MAX_GENERATED_UNITS = 500;

/**
 * Price per m² in centimes, rounded half-up. `area` is the decimal string stored in
 * `numeric(10,2)` ("85.50"). Null when the area is missing or zero.
 */
export function pricePerSquareMeter(price: bigint, area: string | null): bigint | null {
  if (!area) return null;
  const [whole = "0", fraction = ""] = area.split(".");
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2) || "0");
  if (hundredths <= 0n) return null;
  return (price * 100n * 2n + hundredths) / (hundredths * 2n);
}

/** Price for an area at a price per m² (centimes), rounded half-up. `area` as in `numeric(10,2)`. */
export function priceForArea(pricePerSqm: bigint, area: string): bigint {
  const [whole = "0", fraction = ""] = area.split(".");
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2) || "0");
  return (pricePerSqm * hundredths + 50n) / 100n;
}
