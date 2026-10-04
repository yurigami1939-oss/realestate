/** Isomorphic: shared by the assembly forms and their actions. */
import { z } from "zod";

import { assemblyKinds, attendanceKinds, majorities, voteChoices } from "@/lib/assemblies";
import { dateText, optionalText, requiredText } from "@/lib/zod";

/** "18:30" */
const timeText = () => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "validation.time");

const assemblyFields = {
  kind: z.enum(assemblyKinds),
  heldOn: dateText(),
  startTime: timeText(),
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

/**
 * Attendance sheet, saved as a whole: one row per unit of the residence (a unit left out is
 * absent); a represented co-owner needs the name of their proxy.
 */
export const saveAttendanceSchema = z.object({
  assemblyId: z.uuid(),
  rows: z
    .array(
      z
        .object({
          unitId: z.uuid(),
          kind: z.enum(attendanceKinds),
          proxyName: optionalText(200),
        })
        .superRefine((row, ctx) => {
          if (row.kind === "represented" && !row.proxyName) {
            ctx.addIssue({
              code: "custom",
              path: ["proxyName"],
              message: "assemblies.errors.proxyRequired",
            });
          }
        }),
    )
    .max(2000),
});

/** Every vote of the assembly, saved as a whole: one choice per voting unit and resolution. */
export const saveVotesSchema = z.object({
  assemblyId: z.uuid(),
  votes: z
    .array(z.object({ resolutionId: z.uuid(), unitId: z.uuid(), choice: z.enum(voteChoices) }))
    // One insert: 5 parameters per vote, under Postgres' 65 535.
    .max(10_000),
});

/** Closing: the bureau of the meeting and its end time are printed on the minutes. */
export const closeAssemblySchema = z.object({
  assemblyId: z.uuid(),
  chairName: requiredText(200),
  secretaryName: optionalText(200),
  endTime: z
    .union([timeText(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
});
