import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, portalLink, resident, roomBooking } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import type { PortalCtx } from "@/server/portal/context";
import { addResidentSchema, createResidenceSchema } from "@/server/residences/schemas";
import { addResident, createResidence } from "@/server/residences/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import {
  createRoomSchema,
  decideBookingSchema,
  portalBookingSchema,
  staffBookingSchema,
  updateRoomSchema,
} from "./schemas";
import {
  archiveRoom,
  bookRoom,
  cancelPortalBooking,
  createRoom,
  decideBooking,
  listPortalRooms,
  listRooms,
  requestPortalBooking,
  updateRoom,
} from "./service";

afterAll(async () => {
  await stopEnqueue();
});

/** A portal account linked to a resident record, as an accepted invitation. */
async function portalAccount(staff: TenantCtx, residentId: string): Promise<PortalCtx> {
  const member = await addMember(staff.orgId, ["resident"]);
  await withTenant(staff, (tx) =>
    tx.insert(portalLink).values({
      organizationId: staff.orgId,
      email: `client-${randomUUID().slice(0, 8)}@example.test`,
      userId: member.userId,
      residentId,
      createdBy: staff.userId,
    }),
  );
  return { userId: member.userId, orgId: staff.orgId, name: "Résident", locale: "fr" };
}

const tomorrow = addDays(todayInAlgiers(), 1);

describe("common rooms", () => {
  it("lets residents book a room within its rules, the gestionnaire confirming", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const manager = await addMember(team.orgId, ["property_manager"]);
    const year = Number(todayInAlgiers().slice(0, 4));
    const { id: residenceId } = await createResidence(
      manager,
      createResidenceSchema.parse({
        projectId: setup.projectId,
        name: "Résidence Les Oliviers",
        shareBasis: "10000",
        chargeFrequency: "quarterly",
        reserveFund: "0",
        callDueDays: "30",
      }),
    );
    for (const [unitId, lastName] of [
      [setup.unitIds[0], "Ouali"],
      [setup.unitIds[1], "Saadi"],
    ] as const) {
      await addResident(
        manager,
        addResidentSchema.parse({
          residenceId,
          unitId,
          kind: "co_owner",
          isMain: true,
          lastName,
          firstName: "Nadia",
          email: "",
          sinceOn: `${year}-01-01`,
        }),
      );
    }
    const residents = await withTenant(manager, (tx) =>
      tx.select({ id: resident.id, lastName: resident.lastName }).from(resident),
    );
    const ouali = await portalAccount(
      manager,
      residents.find((r) => r.lastName === "Ouali")?.id ?? "",
    );
    const saadi = await portalAccount(
      manager,
      residents.find((r) => r.lastName === "Saadi")?.id ?? "",
    );
    const stranger = await addMember(team.orgId, ["resident"]);

    // The room: the gestionnaire's; hours in order.
    const roomInput = {
      residenceId,
      name: "Salle polyvalente",
      description: "Rendre la salle propre.",
      capacity: "40",
      opensAt: "08:00",
      closesAt: "22:00",
      maxHours: "4",
      needsApproval: true,
    };
    const room = createRoomSchema.parse(roomInput);
    await expect(createRoom(team.agentA, room)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(() =>
      createRoomSchema.parse({ ...roomInput, opensAt: "22:00", closesAt: "08:00" }),
    ).toThrow();
    expect(() => createRoomSchema.parse({ ...roomInput, opensAt: "8h" })).toThrow();
    const { id: roomId } = await createRoom(manager, room);

    const ask = (who: PortalCtx, from: string, to: string, day = tomorrow) =>
      requestPortalBooking(
        who,
        portalBookingSchema.parse({ roomId, day, from, to, purpose: "Anniversaire", guests: "20" }),
      );

    // Within the rules: a day ahead, inside the hours, not too long.
    await expect(ask(ouali, "10:00", "12:00", addDays(tomorrow, -2))).rejects.toMatchObject({
      messageKey: "rooms.errors.past",
    });
    await expect(ask(ouali, "10:00", "12:00", addDays(tomorrow, 120))).rejects.toMatchObject({
      messageKey: "rooms.errors.tooFar",
    });
    await expect(ask(ouali, "21:00", "23:00")).rejects.toMatchObject({
      messageKey: "rooms.errors.closed",
    });
    await expect(ask(ouali, "10:00", "15:00")).rejects.toMatchObject({
      messageKey: "rooms.errors.tooLong",
    });
    expect(() =>
      portalBookingSchema.parse({
        roomId,
        day: tomorrow,
        from: "12:00",
        to: "10:00",
        purpose: "x",
      }),
    ).toThrow();
    // Only the room's residents.
    await expect(
      requestPortalBooking(
        { userId: stranger.userId, orgId: team.orgId, name: "X", locale: "fr" },
        portalBookingSchema.parse({
          roomId,
          day: tomorrow,
          from: "10:00",
          to: "12:00",
          purpose: "x",
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Requested, the slot held; an overlapping one refused, the next one free.
    const first = await ask(ouali, "18:00", "22:00");
    expect(first.status).toBe("requested");
    await expect(ask(saadi, "20:00", "21:00")).rejects.toMatchObject({
      messageKey: "rooms.errors.taken",
    });
    const second = await ask(saadi, "14:00", "18:00");

    // Residents see the slots taken, never by whom; their own bookings.
    const portal = await listPortalRooms(saadi);
    expect(portal.rooms[0]?.taken).toHaveLength(2);
    expect(JSON.stringify(portal.rooms[0]?.taken)).not.toContain("Ouali");
    expect(portal.mine.map((b) => b.id)).toEqual([second.id]);

    // The gestionnaire confirms one, refuses the other with a note the resident reads.
    await expect(
      decideBooking(manager, decideBookingSchema.parse({ bookingId: second.id, approve: false })),
    ).rejects.toMatchObject({ messageKey: "rooms.errors.noteRequired" });
    await decideBooking(
      manager,
      decideBookingSchema.parse({ bookingId: first.id, approve: true, note: "" }),
    );
    await decideBooking(
      manager,
      decideBookingSchema.parse({
        bookingId: second.id,
        approve: false,
        note: "Ménage de la salle cet après-midi.",
      }),
    );
    await expect(
      decideBooking(
        manager,
        decideBookingSchema.parse({ bookingId: first.id, approve: false, note: "x" }),
      ),
    ).rejects.toMatchObject({ messageKey: "rooms.errors.notRequested" });
    expect((await listPortalRooms(saadi)).mine[0]).toMatchObject({
      status: "rejected",
      decisionNote: "Ménage de la salle cet après-midi.",
    });
    // A refused slot is free again.
    const third = await ask(saadi, "15:00", "17:00");

    // A resident cancels its own booking, never another's.
    await expect(cancelPortalBooking(saadi, { bookingId: first.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await cancelPortalBooking(saadi, { bookingId: third.id });

    // Staff book for the council (approved at once); the room's list.
    await bookRoom(
      manager,
      staffBookingSchema.parse({
        roomId,
        day: addDays(tomorrow, 1),
        from: "09:00",
        to: "11:00",
        purpose: "Réunion du conseil syndical",
        bookedFor: "Conseil syndical",
      }),
    );
    const [listed] = await listRooms(manager, residenceId);
    expect(listed?.bookings.map((b) => [b.bookedFor, b.status])).toEqual([
      ["Saadi Nadia", "rejected"],
      ["Saadi Nadia", "cancelled"],
      ["Ouali Nadia", "approved"],
      ["Conseil syndical", "approved"],
    ]);

    // A room with bookings ahead is not withdrawn; corrected instead.
    await expect(archiveRoom(manager, { roomId })).rejects.toMatchObject({
      messageKey: "rooms.errors.bookedAhead",
    });
    await updateRoom(
      manager,
      updateRoomSchema.parse({ ...roomInput, roomId, needsApproval: false, maxHours: "6" }),
    );
    const instant = await ask(ouali, "08:00", "10:00", addDays(tomorrow, 2));
    expect(instant.status).toBe("approved");
    await ask(ouali, "08:00", "09:00", addDays(tomorrow, 3));
    await expect(ask(ouali, "08:00", "09:00", addDays(tomorrow, 4))).rejects.toMatchObject({
      messageKey: "rooms.errors.tooMany",
    });

    // Bookings are kept (no deletion).
    await expect(
      withTenant(manager, (tx) => tx.delete(roomBooking).where(eq(roomBooking.id, third.id))),
    ).rejects.toThrow();
    const audits = await withTenant(manager, (tx) => tx.select().from(auditLog));
    expect(audits.filter((a) => a.action.startsWith("room_booking.")).map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "room_booking.request",
        "room_booking.approve",
        "room_booking.reject",
        "room_booking.cancel",
        "room_booking.create",
      ]),
    );
  });
});
