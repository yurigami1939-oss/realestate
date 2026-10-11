/**
 * Demo common room (CLAUDE.md §7 Residence charges, common rooms): El Yasmine's salle
 * polyvalente, booked on approval, with the council's next meeting already in it.
 */
import { eq } from "drizzle-orm";

import { residence } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createRoomSchema, staffBookingSchema } from "@/server/rooms/schemas";
import { bookRoom, createRoom } from "@/server/rooms/service";

export async function seedRooms(manager: TenantCtx) {
  const [home] = await withTenant(manager, (tx) =>
    tx
      .select({ id: residence.id })
      .from(residence)
      .where(eq(residence.name, "Résidence El Yasmine")),
  );
  if (!home) throw new Error("seed: El Yasmine missing");
  const { id: roomId } = await createRoom(
    manager,
    createRoomSchema.parse({
      residenceId: home.id,
      name: "Salle polyvalente",
      description:
        "Au rez-de-chaussée du bloc A. À rendre propre et rangée ; pas de musique après 22 h.",
      capacity: "40",
      opensAt: "09:00",
      closesAt: "22:00",
      maxHours: "5",
      needsApproval: true,
    }),
  );
  await bookRoom(
    manager,
    staffBookingSchema.parse({
      roomId,
      day: addDays(todayInAlgiers(), 10),
      from: "18:00",
      to: "20:00",
      purpose: "Réunion du conseil syndical",
      bookedFor: "Conseil syndical",
    }),
  );
}
