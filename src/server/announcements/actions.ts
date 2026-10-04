"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  announcementIdSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "./schemas";
import {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  publishAnnouncement,
  updateAnnouncement,
} from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/residences", "layout");
    return result;
  });
}

export const createAnnouncementAction = defineAction(
  { input: createAnnouncementSchema, permission: "announcement:update" },
  (input, ctx) => mutation(() => createAnnouncement(ctx, input)),
);
export const updateAnnouncementAction = defineAction(
  { input: updateAnnouncementSchema, permission: "announcement:update" },
  (input, ctx) => mutation(() => updateAnnouncement(ctx, input)),
);
export const deleteAnnouncementAction = defineAction(
  { input: announcementIdSchema, permission: "announcement:update" },
  (input, ctx) => mutation(() => deleteAnnouncement(ctx, input.announcementId)),
);
export const publishAnnouncementAction = defineAction(
  { input: announcementIdSchema, permission: "announcement:update" },
  (input, ctx) => mutation(() => publishAnnouncement(ctx, input.announcementId)),
);
export const archiveAnnouncementAction = defineAction(
  { input: announcementIdSchema, permission: "announcement:update" },
  (input, ctx) => mutation(() => archiveAnnouncement(ctx, input.announcementId)),
);
