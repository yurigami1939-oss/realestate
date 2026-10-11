/** Isomorphic: shared by the common rooms' forms and actions. */
import { z } from "zod";

import { TIME_OF_DAY } from "@/lib/rooms";
import { dateText, intText, optionalIntText, optionalText, requiredText } from "@/lib/zod";

const time = () => z.string().trim().regex(TIME_OF_DAY, "validation.time");

const roomFields = {
  name: requiredText(120),
  description: optionalText(1000),
  capacity: optionalIntText(1, 1000),
  opensAt: time(),
  closesAt: time(),
  maxHours: intText(1, 24),
  needsApproval: z.boolean(),
};

const hoursInOrder = (v: { opensAt: string; closesAt: string }) => v.opensAt < v.closesAt;

export const createRoomSchema = z
  .object({ residenceId: z.uuid(), ...roomFields })
  .refine(hoursInOrder, { path: ["closesAt"], message: "rooms.errors.hours" });
export const updateRoomSchema = z
  .object({ roomId: z.uuid(), ...roomFields })
  .refine(hoursInOrder, { path: ["closesAt"], message: "rooms.errors.hours" });
export const roomIdSchema = z.object({ roomId: z.uuid() });

/** A slot of one day, in Algiers time. */
const slot = {
  roomId: z.uuid(),
  day: dateText(),
  from: time(),
  to: time(),
  purpose: requiredText(300),
  guests: optionalIntText(1, 1000),
};
const slotInOrder = (v: { from: string; to: string }) => v.from < v.to;

/** A resident's booking from the portal. */
export const portalBookingSchema = z
  .object(slot)
  .refine(slotInOrder, { path: ["to"], message: "rooms.errors.slot" });

/** Staff book for someone (a resident, the council, the company). */
export const staffBookingSchema = z
  .object({ ...slot, bookedFor: requiredText(120) })
  .refine(slotInOrder, { path: ["to"], message: "rooms.errors.slot" });

export const decideBookingSchema = z.object({
  bookingId: z.uuid(),
  approve: z.boolean(),
  note: optionalText(500),
});
export const bookingIdSchema = z.object({ bookingId: z.uuid() });
