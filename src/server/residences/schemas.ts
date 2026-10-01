/** Isomorphic: shared by the residence forms and their actions. */
import { z } from "zod";

import { chargeFrequencies, MAX_SHARE_BASIS, residentKinds } from "@/lib/residences";
import {
  dateText,
  intText,
  optionalDateText,
  optionalEmailText,
  optionalPhoneText,
  optionalText,
  percentText,
  requiredText,
} from "@/lib/zod";

const residenceFields = {
  name: requiredText(120),
  address: optionalText(300),
  commune: optionalText(80),
  wilaya: optionalText(80),
  /** Total the tantièmes are expressed in. */
  shareBasis: intText(1, MAX_SHARE_BASIS),
  chargeFrequency: z.enum(chargeFrequencies),
  /** Reserve fund, % of the annual budget (0 = none). */
  reserveFund: percentText(0, 100),
  callDueDays: intText(0, 365),
  notes: optionalText(1000),
};

/** A residence on a project: its live units join it (tantièmes to enter). */
export const createResidenceSchema = z.object({ projectId: z.uuid(), ...residenceFields });
export const updateResidenceSchema = z.object({ residenceId: z.uuid(), ...residenceFields });
export const residenceIdSchema = z.object({ residenceId: z.uuid() });

/** Tantièmes of the residence's units, saved as a whole. */
export const saveSharesSchema = z.object({
  residenceId: z.uuid(),
  shares: z.array(z.object({ unitId: z.uuid(), share: intText(0, MAX_SHARE_BASIS) })).max(2000),
});

/** Co-owner or occupant of a unit. */
export const addResidentSchema = z.object({
  residenceId: z.uuid(),
  unitId: z.uuid(),
  kind: z.enum(residentKinds),
  isMain: z.boolean(),
  lastName: requiredText(80),
  firstName: requiredText(80),
  lastNameAr: optionalText(80),
  firstNameAr: optionalText(80),
  phone: optionalPhoneText(),
  email: optionalEmailText(),
  address: optionalText(300),
  sinceOn: optionalDateText(),
  notes: optionalText(1000),
});

/** End of ownership or occupancy (sale of the unit, tenant leaving). */
export const endResidentSchema = z.object({
  residentId: z.uuid(),
  untilOn: dateText(),
});

export const RESIDENCES_PAGE_SIZE = 50;
