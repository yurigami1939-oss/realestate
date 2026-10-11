/**
 * Demo visitors (CLAUDE.md §7 Residence charges, visitors): the demo resident announced a
 * visitor for tomorrow at El Yasmine; a delivery came unannounced today.
 */
import { eq } from "drizzle-orm";

import { residence } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import type { PortalCtx } from "@/server/portal/context";
import { announceVisitorSchema, logVisitorSchema } from "@/server/visitors/schemas";
import { announceVisitor, listPortalVisitors, logVisitor } from "@/server/visitors/service";

export async function seedVisitors(manager: TenantCtx, resident: PortalCtx) {
  const { units } = await listPortalVisitors(resident);
  const home = units.find((u) => u.residenceName === "Résidence El Yasmine");
  if (!home) throw new Error("seed: the resident's El Yasmine unit is missing");
  await announceVisitor(
    resident,
    announceVisitorSchema.parse({
      unitId: home.id,
      visitorName: "Sofiane Cherif",
      expectedOn: addDays(todayInAlgiers(), 1),
      people: "3",
      note: "Ma famille, de Constantine",
    }),
  );
  const [yasmine] = await withTenant(manager, (tx) =>
    tx
      .select({ id: residence.id })
      .from(residence)
      .where(eq(residence.name, "Résidence El Yasmine")),
  );
  if (!yasmine) throw new Error("seed: El Yasmine missing");
  await logVisitor(
    manager,
    logVisitorSchema.parse({
      residenceId: yasmine.id,
      unitId: "",
      hostName: "Gardien",
      visitorName: "Livreur Sonelgaz",
      people: "1",
      note: "Relevé des compteurs des parties communes",
    }),
  );
}
