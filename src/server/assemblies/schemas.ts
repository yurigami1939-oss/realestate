/** Isomorphic: shared by the assembly forms and their actions. */
import { z } from "zod";

import { assemblyKinds, majorities } from "@/lib/assemblies";
import { dateText, optionalText, requiredText } from "@/lib/zod";

const assemblyFields = {
  kind: z.enum(assemblyKinds),
  heldOn: dateText(),
  /** "18:30" */
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "validation.time"),
  place: requiredText(200),
  notes: optionalText(2000),
};

export const createAssemblySchema = z.object({ residenceId: z.uuid(), ...assemblyFields });
export const updateAssemblySchema = z.object({ assemblyId: z.uuid(), ...assemblyFields });
export const assemblyIdSchema = z.object({ assemblyId: z.uuid() });

const resolutionFields = {
  title: requiredText(300),
  titleAr: optionalText(300),
  description: optionalText(4000),
  majority: z.enum(majorities),
};

export const addResolutionSchema = z.object({ assemblyId: z.uuid(), ...resolutionFields });
export const updateResolutionSchema = z.object({ resolutionId: z.uuid(), ...resolutionFields });
export const resolutionIdSchema = z.object({ resolutionId: z.uuid() });
