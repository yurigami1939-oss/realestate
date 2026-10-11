"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";
import { definePortalAction } from "@/server/portal/action";

import {
  bookingIdSchema,
  createRoomSchema,
  decideBookingSchema,
  portalBookingSchema,
  roomIdSchema,
  staffBookingSchema,
  updateRoomSchema,
} from "./schemas";
import {
  archiveRoom,
  bookRoom,
  cancelBooking,
  cancelPortalBooking,
  createRoom,
  decideBooking,
  requestPortalBooking,
  updateRoom,
} from "./service";

const ROOMS_PAGE = "/[locale]/residences/[residenceId]/rooms";
const PORTAL_PAGE = "/[locale]/portal/rooms";

export const createRoomAction = defineAction(
  { input: createRoomSchema, permission: "residence:update" },
  async (input, ctx) => {
    const created = await createRoom(ctx, input);
    revalidatePath(ROOMS_PAGE, "page");
    return created;
  },
);
export const updateRoomAction = defineAction(
  { input: updateRoomSchema, permission: "residence:update" },
  async (input, ctx) => {
    await updateRoom(ctx, input);
    revalidatePath(ROOMS_PAGE, "page");
  },
);
export const archiveRoomAction = defineAction(
  { input: roomIdSchema, permission: "residence:update" },
  async (input, ctx) => {
    await archiveRoom(ctx, input);
    revalidatePath(ROOMS_PAGE, "page");
  },
);
export const bookRoomAction = defineAction(
  { input: staffBookingSchema, permission: "residence:update" },
  async (input, ctx) => {
    const booked = await bookRoom(ctx, input);
    revalidatePath(ROOMS_PAGE, "page");
    return booked;
  },
);
export const decideBookingAction = defineAction(
  { input: decideBookingSchema, permission: "residence:update" },
  async (input, ctx) => {
    await decideBooking(ctx, input);
    revalidatePath(ROOMS_PAGE, "page");
  },
);
export const cancelBookingAction = defineAction(
  { input: bookingIdSchema, permission: "residence:update" },
  async (input, ctx) => {
    await cancelBooking(ctx, input);
    revalidatePath(ROOMS_PAGE, "page");
  },
);

export const requestPortalBookingAction = definePortalAction(
  portalBookingSchema,
  async (input, ctx) => {
    const booked = await requestPortalBooking(ctx, input);
    revalidatePath(PORTAL_PAGE, "page");
    return booked;
  },
);
export const cancelPortalBookingAction = definePortalAction(bookingIdSchema, async (input, ctx) => {
  await cancelPortalBooking(ctx, input);
  revalidatePath(PORTAL_PAGE, "page");
});
