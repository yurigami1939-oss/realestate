/** Isomorphic: shared by the announcement forms and their actions. */
import { z } from "zod";

import { announcementCategories } from "@/lib/announcements";
import { optionalDateText, optionalText, requiredText } from "@/lib/zod";

const announcementFields = {
  category: z.enum(announcementCategories),
  title: requiredText(200),
  titleAr: optionalText(200),
  body: requiredText(4000),
  bodyAr: optionalText(4000),
  /** Last day it is shown; "" = until withdrawn. */
  expiresOn: optionalDateText(),
  pinned: z.boolean(),
};

export const createAnnouncementSchema = z.object({
  residenceId: z.uuid(),
  ...announcementFields,
});
export const updateAnnouncementSchema = z.object({
  announcementId: z.uuid(),
  ...announcementFields,
});
export const announcementIdSchema = z.object({ announcementId: z.uuid() });
