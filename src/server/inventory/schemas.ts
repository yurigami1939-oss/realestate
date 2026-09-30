/** Isomorphic: shared by inventory forms and actions. Inputs are form strings. */
import { z } from "zod";

import {
  MAX_GENERATED_UNITS,
  orientations,
  projectStatuses,
  typologies,
  unitTypes,
} from "@/lib/inventory";
import {
  codeText,
  intText,
  moneyText,
  optionalAreaText,
  optionalDateText,
  optionalEnum,
  optionalIntText,
  optionalText,
  requiredText,
} from "@/lib/zod";

const FLOOR_MIN = -10;
const FLOOR_MAX = 80;

// ── Projects ────────────────────────────────────────────────────────────────

export const projectFields = z.object({
  code: codeText(12),
  name: requiredText(120),
  status: z.enum(projectStatuses),
  address: optionalText(300),
  wilaya: optionalText(80),
  commune: optionalText(80),
  buildingPermitNumber: optionalText(80),
  buildingPermitDate: optionalDateText(),
  launchedOn: optionalDateText(),
  plannedDeliveryOn: optionalDateText(),
  description: optionalText(2000),
});

export const createProjectSchema = projectFields;
export const updateProjectSchema = projectFields.extend({ projectId: z.uuid() });
export const deleteProjectSchema = z.object({ projectId: z.uuid() });

// ── Buildings ───────────────────────────────────────────────────────────────

const floorRange = <T extends { lowestFloor: number; topFloor: number }>(v: T) =>
  v.topFloor >= v.lowestFloor;

export const buildingFields = z.object({
  code: codeText(10),
  name: requiredText(80),
  lowestFloor: intText(FLOOR_MIN, 0),
  topFloor: intText(0, FLOOR_MAX),
});

export const createBuildingSchema = buildingFields
  .extend({ projectId: z.uuid() })
  .refine(floorRange, { path: ["topFloor"], message: "validation.floorRange" });
export const updateBuildingSchema = buildingFields
  .extend({ buildingId: z.uuid() })
  .refine(floorRange, { path: ["topFloor"], message: "validation.floorRange" });
export const deleteBuildingSchema = z.object({ buildingId: z.uuid() });

// ── Units ───────────────────────────────────────────────────────────────────

export const unitFields = z.object({
  buildingId: z.uuid(),
  code: codeText(20),
  floor: intText(FLOOR_MIN, FLOOR_MAX),
  type: z.enum(unitTypes),
  typology: optionalEnum(typologies),
  isDuplex: z.boolean(),
  livingArea: optionalAreaText(),
  usableArea: optionalAreaText(),
  outdoorArea: optionalAreaText(),
  orientations: z.array(z.enum(orientations)).max(orientations.length),
  share: optionalIntText(1, 1_000_000),
  notes: optionalText(2000),
});

export const createUnitSchema = unitFields;
export const updateUnitSchema = unitFields.extend({ unitId: z.uuid() });
export const deleteUnitSchema = z.object({ unitId: z.uuid() });

/** Actions on one unit that take no other input (e.g. removing its floor plan). */
export const unitIdSchema = z.object({ unitId: z.uuid() });

export const generateUnitsSchema = z
  .object({
    buildingId: z.uuid(),
    fromFloor: intText(FLOOR_MIN, FLOOR_MAX),
    toFloor: intText(FLOOR_MIN, FLOOR_MAX),
    unitsPerFloor: intText(1, 40),
    type: z.enum(unitTypes),
    typology: optionalEnum(typologies),
    livingArea: optionalAreaText(),
  })
  .refine((v) => v.toFloor >= v.fromFloor, { path: ["toFloor"], message: "validation.floorRange" })
  .refine((v) => (v.toFloor - v.fromFloor + 1) * v.unitsPerFloor <= MAX_GENERATED_UNITS, {
    path: ["unitsPerFloor"],
    message: "validation.tooManyUnits",
  });

/** Block / unblock: a reason is mandatory (audited). */
export const unitStatusReasonSchema = z.object({ unitId: z.uuid(), reason: requiredText(300) });

export const updateUnitPriceSchema = z.object({
  unitId: z.uuid(),
  price: moneyText(),
  reason: requiredText(300),
});

// ── Price lists ─────────────────────────────────────────────────────────────

export const createPriceListSchema = z.object({ projectId: z.uuid(), name: requiredText(120) });

/** Full replacement of the draft's items (units left out have no price in this list). */
export const setPriceListItemsSchema = z.object({
  priceListId: z.uuid(),
  items: z.array(z.object({ unitId: z.uuid(), price: moneyText() })).max(5000),
});

export const priceListIdSchema = z.object({ priceListId: z.uuid() });
