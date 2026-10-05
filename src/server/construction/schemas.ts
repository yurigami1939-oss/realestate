/** Isomorphic: shared by the construction report forms and their actions. */
import { z } from "zod";

import { dateText, optionalIntText, optionalText, requiredText } from "@/lib/zod";

/** Site photos kept per report. */
export const MAX_REPORT_PHOTOS = 20;

const reportFields = {
  reportedOn: dateText(),
  title: requiredText(200),
  titleAr: optionalText(200),
  body: optionalText(4000),
  bodyAr: optionalText(4000),
  /** Shown to the project's buyers on the portal. */
  published: z.boolean(),
  /** Progress of the buildings reported on, in percent; "" = not reported this time. */
  progress: z.array(z.object({ buildingId: z.uuid(), percent: optionalIntText(0, 100) })).max(50),
};

export const createReportSchema = z.object({ projectId: z.uuid(), ...reportFields });
export const updateReportSchema = z.object({ reportId: z.uuid(), ...reportFields });
export const reportIdSchema = z.object({ reportId: z.uuid() });
export const reportPhotoSchema = z.object({ reportId: z.uuid(), fileId: z.uuid() });
