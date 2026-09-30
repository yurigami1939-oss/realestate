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

/** Allowed transitions. Anything else is INVALID_TRANSITION. `delivered` is terminal. */
export const unitTransitions: Record<UnitStatus, readonly UnitStatus[]> = {
  available: ["optioned", "reserved", "blocked", "rented"],
  optioned: ["available", "reserved"],
  reserved: ["available", "sold"],
  sold: ["delivered"],
  delivered: [],
  rented: ["available"],
  blocked: ["available"],
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
