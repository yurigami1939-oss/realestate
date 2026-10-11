import "server-only";

import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { commonRoom, residence, resident, roomBooking } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  addDays,
  type CalendarDate,
  formatDate,
  fromAlgiersDateTime,
  toAlgiersDateTimeInput,
  todayInAlgiers,
} from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { AppError } from "@/lib/result";
import {
  BOOKING_DAYS_AHEAD,
  BOOKINGS_PER_ACCOUNT,
  liveBookingStatuses,
  minutesOf,
} from "@/lib/rooms";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import type { PortalCtx } from "@/server/portal/context";
import { portalScope } from "@/server/portal/context";
import { queuePush, residentAccounts, staffWith } from "@/server/push/notify";
import { loadResidence } from "@/server/residences/service";

import type {
  bookingIdSchema,
  createRoomSchema,
  decideBookingSchema,
  portalBookingSchema,
  roomIdSchema,
  staffBookingSchema,
  updateRoomSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;
type Actor = { orgId: string; userId: string };
type Room = typeof commonRoom.$inferSelect;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

async function loadRoom(tx: Tx, roomId: string, options: { forUpdate?: boolean } = {}) {
  if (!isUuid(roomId)) throw new AppError("NOT_FOUND");
  const query = tx.select().from(commonRoom).where(eq(commonRoom.id, roomId));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** "HH:MM" in Algiers of an instant. */
export const timeOf = (instant: Date) => toAlgiersDateTimeInput(instant).slice(11);

/**
 * A common room of a residence residents may book (`residence:update`: gérant, gestionnaire):
 * its hours, the longest booking, whether each booking is approved. Audited on the residence.
 */
export async function createRoom(ctx: TenantCtx, input: In<typeof createRoomSchema>) {
  assertCan(ctx, "residence:update");
  return withTenant(ctx, async (tx) => {
    await loadResidence(tx, input.residenceId);
    const [row] = await tx
      .insert(commonRoom)
      .values({ ...input, organizationId: ctx.orgId, createdBy: ctx.userId })
      .returning({ id: commonRoom.id });
    if (!row) throw new Error("createRoom: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "common_room.create",
      entityType: "residence",
      entityId: input.residenceId,
      after: { room: input.name, opensAt: input.opensAt, closesAt: input.closesAt },
    });
    return { id: row.id };
  });
}

/** Corrects a room (bookings already made keep their slots). Audited. */
export async function updateRoom(ctx: TenantCtx, input: In<typeof updateRoomSchema>) {
  assertCan(ctx, "residence:update");
  await withTenant(ctx, async (tx) => {
    const { roomId, ...values } = input;
    const before = await loadRoom(tx, roomId, { forUpdate: true });
    if (before.archivedAt) throw new AppError("CONFLICT", "rooms.errors.archived");
    await tx
      .update(commonRoom)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(commonRoom.id, roomId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "common_room.update",
      entityType: "residence",
      entityId: before.residenceId,
      before: { room: before.name, opensAt: before.opensAt, closesAt: before.closesAt },
      after: { room: values.name, opensAt: values.opensAt, closesAt: values.closesAt },
    });
  });
}

/** A room no longer offered: archived once nothing is booked ahead. Audited. */
export async function archiveRoom(ctx: TenantCtx, input: In<typeof roomIdSchema>) {
  assertCan(ctx, "residence:update");
  await withTenant(ctx, async (tx) => {
    const room = await loadRoom(tx, input.roomId, { forUpdate: true });
    if (room.archivedAt) return;
    const [ahead] = await tx
      .select({ n: count() })
      .from(roomBooking)
      .where(
        and(
          eq(roomBooking.roomId, room.id),
          inArray(roomBooking.status, [...liveBookingStatuses]),
          gt(roomBooking.endsAt, new Date()),
        ),
      );
    if ((ahead?.n ?? 0) > 0) throw new AppError("CONFLICT", "rooms.errors.bookedAhead");
    await tx
      .update(commonRoom)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(commonRoom.id, room.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "common_room.archive",
      entityType: "residence",
      entityId: room.residenceId,
      before: { room: room.name },
    });
  });
}

/**
 * The slot asked for, as instants, within the room's rules: a day from today to
 * `BOOKING_DAYS_AHEAD` days ahead, inside its hours, not longer than its longest booking, not
 * already begun.
 */
function slotOf(room: Room, input: { day: CalendarDate; from: string; to: string }) {
  const today = todayInAlgiers();
  if (input.day < today) throw invalid("day", "rooms.errors.past");
  if (input.day > addDays(today, BOOKING_DAYS_AHEAD)) throw invalid("day", "rooms.errors.tooFar");
  if (input.from < room.opensAt || input.to > room.closesAt) {
    throw invalid("from", "rooms.errors.closed");
  }
  if (minutesOf(input.to) - minutesOf(input.from) > room.maxHours * 60) {
    throw invalid("to", "rooms.errors.tooLong");
  }
  const startsAt = fromAlgiersDateTime(`${input.day}T${input.from}`);
  const endsAt = fromAlgiersDateTime(`${input.day}T${input.to}`);
  if (!startsAt || !endsAt) throw invalid("day", "validation.date");
  if (startsAt <= new Date()) throw invalid("from", "rooms.errors.past");
  return { startsAt, endsAt };
}

/** Refused when a live booking of the room overlaps the slot (the room row is locked). */
async function assertFree(
  tx: Tx,
  roomId: string,
  slot: { startsAt: Date; endsAt: Date },
  exceptId?: string,
) {
  const [taken] = await tx
    .select({ id: roomBooking.id })
    .from(roomBooking)
    .where(
      and(
        eq(roomBooking.roomId, roomId),
        inArray(roomBooking.status, [...liveBookingStatuses]),
        lt(roomBooking.startsAt, slot.endsAt),
        gt(roomBooking.endsAt, slot.startsAt),
        exceptId ? ne(roomBooking.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (taken) throw new AppError("CONFLICT", "rooms.errors.taken");
}

const slotParams = (room: Room, slot: { startsAt: Date; endsAt: Date }) => ({
  room: room.name,
  day: formatDate(slot.startsAt),
  from: timeOf(slot.startsAt),
  to: timeOf(slot.endsAt),
});

/**
 * A resident books a common room of its residence from the portal: the slot within the room's
 * rules and free, at most `BOOKINGS_PER_ACCOUNT` upcoming bookings per account; approved at
 * once when the room needs no approval, else requested (the gestionnaires are told). Audited.
 */
export async function requestPortalBooking(ctx: PortalCtx, input: In<typeof portalBookingSchema>) {
  return withTenant(ctx, async (tx) => {
    // The room's row lock serializes the bookings of the room.
    const room = await loadRoom(tx, input.roomId, { forUpdate: true });
    if (room.archivedAt) throw new AppError("NOT_FOUND");
    const { residents } = await portalScope(tx, ctx);
    const here = residents.find((r) => r.residenceId === room.residenceId);
    if (!here) throw new AppError("NOT_FOUND");
    const slot = slotOf(room, input);
    const [ahead] = await tx
      .select({ n: count() })
      .from(roomBooking)
      .where(
        and(
          eq(roomBooking.requestedBy, ctx.userId),
          inArray(roomBooking.status, [...liveBookingStatuses]),
          gt(roomBooking.endsAt, new Date()),
        ),
      );
    if ((ahead?.n ?? 0) >= BOOKINGS_PER_ACCOUNT) {
      throw new AppError("CONFLICT", "rooms.errors.tooMany");
    }
    await assertFree(tx, room.id, slot);
    const [person] = await tx
      .select({ lastName: resident.lastName, firstName: resident.firstName })
      .from(resident)
      .where(eq(resident.id, here.id));
    const status = room.needsApproval ? ("requested" as const) : ("approved" as const);
    const bookedFor = person ? `${person.lastName} ${person.firstName}` : ctx.name;
    const [row] = await tx
      .insert(roomBooking)
      .values({
        organizationId: ctx.orgId,
        roomId: room.id,
        residenceId: room.residenceId,
        residentId: here.id,
        bookedFor,
        ...slot,
        purpose: input.purpose,
        guests: input.guests,
        status,
        requestedBy: ctx.userId,
        decidedAt: status === "approved" ? new Date() : null,
      })
      .returning({ id: roomBooking.id });
    if (!row) throw new Error("requestPortalBooking: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "room_booking.request",
      entityType: "residence",
      entityId: room.residenceId,
      after: { room: room.name, startsAt: slot.startsAt, endsAt: slot.endsAt, status },
    });
    if (status === "requested") {
      await queuePush(tx, ctx, "room_requested", async () => ({
        userIds: await staffWith(tx, ctx.orgId, ["residence:update"]),
        params: { ...slotParams(room, slot), who: bookedFor },
        url: `/residences/${room.residenceId}/rooms`,
      }));
    }
    return { id: row.id, status };
  });
}

/** Staff book a room for someone (approved at once, the same rules). Audited. */
export async function bookRoom(ctx: TenantCtx, input: In<typeof staffBookingSchema>) {
  assertCan(ctx, "residence:update");
  return withTenant(ctx, async (tx) => {
    const room = await loadRoom(tx, input.roomId, { forUpdate: true });
    if (room.archivedAt) throw new AppError("CONFLICT", "rooms.errors.archived");
    const slot = slotOf(room, input);
    await assertFree(tx, room.id, slot);
    const [row] = await tx
      .insert(roomBooking)
      .values({
        organizationId: ctx.orgId,
        roomId: room.id,
        residenceId: room.residenceId,
        bookedFor: input.bookedFor,
        ...slot,
        purpose: input.purpose,
        guests: input.guests,
        status: "approved",
        requestedBy: ctx.userId,
        decidedBy: ctx.userId,
        decidedAt: new Date(),
      })
      .returning({ id: roomBooking.id });
    if (!row) throw new Error("bookRoom: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "room_booking.create",
      entityType: "residence",
      entityId: room.residenceId,
      after: { room: room.name, for: input.bookedFor, startsAt: slot.startsAt },
    });
    return { id: row.id };
  });
}

async function loadBooking(tx: Tx, bookingId: string) {
  if (!isUuid(bookingId)) throw new AppError("NOT_FOUND");
  const [row] = await tx
    .select({ booking: roomBooking, room: commonRoom })
    .from(roomBooking)
    .innerJoin(commonRoom, eq(commonRoom.id, roomBooking.roomId))
    .where(eq(roomBooking.id, bookingId))
    .for("update", { of: roomBooking });
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/**
 * The gestionnaire approves a requested booking, or rejects it with a note the resident reads;
 * the resident is told. Audited.
 */
export async function decideBooking(ctx: TenantCtx, input: In<typeof decideBookingSchema>) {
  assertCan(ctx, "residence:update");
  if (!input.approve && !input.note) throw invalid("note", "rooms.errors.noteRequired");
  await withTenant(ctx, async (tx) => {
    const { booking, room } = await loadBooking(tx, input.bookingId);
    if (booking.status !== "requested") {
      throw new AppError("CONFLICT", "rooms.errors.notRequested");
    }
    const status = input.approve ? ("approved" as const) : ("rejected" as const);
    await tx
      .update(roomBooking)
      .set({ status, decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: input.note })
      .where(eq(roomBooking.id, booking.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: input.approve ? "room_booking.approve" : "room_booking.reject",
      entityType: "residence",
      entityId: booking.residenceId,
      after: { room: room.name, for: booking.bookedFor, startsAt: booking.startsAt },
      reason: input.note ?? undefined,
    });
    const residentId = booking.residentId;
    if (residentId) {
      await queuePush(tx, ctx, "room_decided", async () => ({
        userIds: await residentAccounts(tx, residentId),
        params: { ...slotParams(room, booking), approved: input.approve ? "yes" : "no" },
        url: "/portal/rooms",
      }));
    }
  });
}

async function cancel(
  tx: Tx,
  actor: Actor,
  { booking, room }: Awaited<ReturnType<typeof loadBooking>>,
) {
  if (booking.status !== "requested" && booking.status !== "approved") {
    throw new AppError("CONFLICT", "rooms.errors.notLive");
  }
  if (booking.endsAt <= new Date()) throw new AppError("CONFLICT", "rooms.errors.over");
  await tx
    .update(roomBooking)
    .set({ status: "cancelled", cancelledBy: actor.userId, cancelledAt: new Date() })
    .where(eq(roomBooking.id, booking.id));
  await recordAudit(tx, actor, {
    actorUserId: actor.userId,
    action: "room_booking.cancel",
    entityType: "residence",
    entityId: booking.residenceId,
    after: { room: room.name, for: booking.bookedFor, startsAt: booking.startsAt },
  });
}

/** Staff cancel a booking not over yet. Audited. */
export async function cancelBooking(ctx: TenantCtx, input: In<typeof bookingIdSchema>) {
  assertCan(ctx, "residence:update");
  await withTenant(ctx, async (tx) => cancel(tx, ctx, await loadBooking(tx, input.bookingId)));
}

/** A resident cancels its own booking from the portal. Audited. */
export async function cancelPortalBooking(ctx: PortalCtx, input: In<typeof bookingIdSchema>) {
  await withTenant(ctx, async (tx) => {
    const loaded = await loadBooking(tx, input.bookingId);
    if (loaded.booking.requestedBy !== ctx.userId) throw new AppError("NOT_FOUND");
    await cancel(tx, ctx, loaded);
  });
}

/** A residence's rooms with their bookings from today on (staff, `residence:read`). */
export async function listRooms(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "residence:read");
  if (!isUuid(residenceId)) return [];
  return withTenant(ctx, async (tx) => {
    const rooms = await tx
      .select()
      .from(commonRoom)
      .where(and(eq(commonRoom.residenceId, residenceId), isNull(commonRoom.archivedAt)))
      .orderBy(asc(commonRoom.name));
    if (rooms.length === 0) return [];
    const since = fromAlgiersDateTime(`${todayInAlgiers()}T00:00`) ?? new Date();
    const bookings = await tx
      .select()
      .from(roomBooking)
      .where(
        and(
          inArray(
            roomBooking.roomId,
            rooms.map((r) => r.id),
          ),
          gt(roomBooking.endsAt, since),
        ),
      )
      .orderBy(asc(roomBooking.startsAt));
    return rooms.map((room) => ({
      ...room,
      bookings: bookings.filter((b) => b.roomId === room.id),
    }));
  });
}

/**
 * The rooms of the residences a portal account lives in, the slots already taken over the
 * coming weeks (never who took them) and the account's own bookings.
 */
export async function listPortalRooms(ctx: PortalCtx) {
  return withTenant(ctx, async (tx) => {
    const { residents } = await portalScope(tx, ctx);
    const residenceIds = [...new Set(residents.map((r) => r.residenceId))];
    if (residenceIds.length === 0) return { rooms: [], mine: [] };
    const rooms = await tx
      .select({
        id: commonRoom.id,
        name: commonRoom.name,
        description: commonRoom.description,
        capacity: commonRoom.capacity,
        opensAt: commonRoom.opensAt,
        closesAt: commonRoom.closesAt,
        maxHours: commonRoom.maxHours,
        needsApproval: commonRoom.needsApproval,
        residenceName: residence.name,
      })
      .from(commonRoom)
      .innerJoin(residence, eq(residence.id, commonRoom.residenceId))
      .where(and(inArray(commonRoom.residenceId, residenceIds), isNull(commonRoom.archivedAt)))
      .orderBy(asc(residence.name), asc(commonRoom.name));
    const now = new Date();
    const taken =
      rooms.length === 0
        ? []
        : await tx
            .select({
              roomId: roomBooking.roomId,
              startsAt: roomBooking.startsAt,
              endsAt: roomBooking.endsAt,
            })
            .from(roomBooking)
            .where(
              and(
                inArray(
                  roomBooking.roomId,
                  rooms.map((r) => r.id),
                ),
                inArray(roomBooking.status, [...liveBookingStatuses]),
                gt(roomBooking.endsAt, now),
              ),
            )
            .orderBy(asc(roomBooking.startsAt));
    const mine = await tx
      .select({
        id: roomBooking.id,
        roomName: commonRoom.name,
        startsAt: roomBooking.startsAt,
        endsAt: roomBooking.endsAt,
        purpose: roomBooking.purpose,
        status: roomBooking.status,
        decisionNote: roomBooking.decisionNote,
      })
      .from(roomBooking)
      .innerJoin(commonRoom, eq(commonRoom.id, roomBooking.roomId))
      .where(eq(roomBooking.requestedBy, ctx.userId))
      .orderBy(desc(roomBooking.startsAt))
      .limit(20);
    return {
      rooms: rooms.map((room) => ({
        ...room,
        taken: taken.filter((b) => b.roomId === room.id).slice(0, 30),
      })),
      mine: mine.map((b) => ({ ...b, over: b.endsAt <= now })),
    };
  });
}
