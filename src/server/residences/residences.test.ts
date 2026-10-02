import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { createUnitSchema } from "@/server/inventory/schemas";
import { createUnit } from "@/server/inventory/service";
import { createReservation, recordSale } from "@/server/sales/reservations";
import { createReservationSchema, recordSaleSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { getResidence, listResidences, listUnitResidents } from "./queries";
import {
  addResidentSchema,
  createResidenceSchema,
  saveSharesSchema,
  updateResidenceSchema,
} from "./schemas";
import {
  addResident,
  createResidence,
  distributeSharesByArea,
  endResident,
  importSaleBuyers,
  saveShares,
  updateResidence,
} from "./service";

const today = todayInAlgiers();

const residenceInput = (projectId: string, overrides: Record<string, string> = {}) =>
  createResidenceSchema.parse({
    projectId,
    name: "Résidence Les Oliviers",
    address: "",
    commune: "Kouba",
    wilaya: "16 - Alger",
    shareBasis: "10000",
    chargeFrequency: "quarterly",
    reserveFund: "5",
    callDueDays: "30",
    notes: "",
    ...overrides,
  });

async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const manager = await addMember(team.orgId, ["property_manager"]);
  const { id: residenceId } = await createResidence(manager, residenceInput(setup.projectId));
  return { team, ...setup, manager, residenceId };
}

const buyerOf = async (ctx: TenantCtx, leadId: string | null, nin: string, firstName: string) =>
  (
    await createBuyer(
      ctx,
      createBuyerSchema.parse({
        lastName: "Saïdi",
        firstName,
        nin,
        phone: "0550 12 34 56",
        leadId: leadId ?? "",
      }),
    )
  ).id;

describe("residences", () => {
  it("are set up on a project with the units' tantièmes", async () => {
    const team = await createSalesTeam();
    const { projectId, buildingId, unitIds } = await createSaleSetup(team);
    // A shop has a usable area only: it weighs in the split all the same.
    const { id: shopId } = await createUnit(
      team.manager,
      createUnitSchema.parse({
        buildingId,
        code: "A-00-01",
        floor: "0",
        type: "commercial",
        isDuplex: false,
        usableArea: "173,50",
        orientations: [],
        share: "900",
      }),
    );
    const manager = await addMember(team.orgId, ["property_manager"]);
    const cashier = await addMember(team.orgId, ["cashier"]);

    await expect(createResidence(team.manager, residenceInput(projectId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { id, units } = await createResidence(manager, residenceInput(projectId));
    expect(units).toBe(4);
    // The quote-part entered on the unit is its starting tantièmes.
    expect((await getResidence(manager, id))?.totalShares).toBe(900);
    // A unit belongs to one residence only.
    expect((await createResidence(manager, residenceInput(projectId, { name: "Bis" }))).units).toBe(
      0,
    );

    await distributeSharesByArea(manager, id);
    const split = await getResidence(manager, id);
    expect(split?.units.map((u) => [u.code, u.share])).toEqual([
      ["A-00-01", 4000],
      ["A-03-01", 2000],
      ["A-03-02", 2000],
      ["A-04-01", 2000],
    ]);
    expect(split?.totalShares).toBe(10_000);

    await saveShares(
      manager,
      saveSharesSchema.parse({
        residenceId: id,
        shares: [
          { unitId: shopId, share: "1000" },
          { unitId: unitIds[0], share: "3000" },
          { unitId: unitIds[1], share: "3000" },
          { unitId: unitIds[2], share: "3000" },
        ],
      }),
    );
    await expect(
      saveShares(
        manager,
        saveSharesSchema.parse({
          residenceId: id,
          shares: [{ unitId: "00000000-0000-7000-8000-000000000000", share: "1" }],
        }),
      ),
    ).rejects.toMatchObject({ messageKey: "residences.errors.unitNotInResidence" });
    await updateResidence(
      manager,
      updateResidenceSchema.parse({
        residenceId: id,
        name: "Résidence Les Oliviers",
        address: "Chemin des Crêtes",
        commune: "Kouba",
        wilaya: "16 - Alger",
        shareBasis: "10000",
        chargeFrequency: "monthly",
        reserveFund: "5",
        callDueDays: "15",
        notes: "",
      }),
    );
    await expect(
      updateResidence(
        cashier,
        updateResidenceSchema.parse({
          residenceId: id,
          name: "X",
          shareBasis: "10000",
          chargeFrequency: "monthly",
          reserveFund: "0",
          callDueDays: "15",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const [row] = (await listResidences(cashier)).filter((r) => r.id === id);
    expect(row).toMatchObject({
      units: 4,
      shares: 10_000,
      unitsWithCoOwner: 0,
      chargeFrequency: "monthly",
    });
    expect((await getResidence(cashier, id))?.reserveFundBp).toBe(500);
    const audit = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, id), eq(auditLog.entityType, "residence"))),
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      "residence.create",
      "residence.shares",
      "residence.shares",
      "residence.update",
    ]);
  });

  it("get their co-owners from sales or by hand, over periods", async () => {
    const { team, unitIds, planId, manager, residenceId } = await scenario();
    const leadId = await newLead(team.agentA);
    const main = await buyerOf(team.agentA, leadId, "109085198500500001", "Yasmine");
    const spouse = await buyerOf(team.agentA, null, "109085198500500002", "Nassim");
    const { id: saleId } = await createReservation(
      team.agentA,
      createReservationSchema.parse({
        unitId: unitIds[0],
        buyerIds: [main, spouse],
        paymentPlanId: planId,
        discount: "",
        reservedOn: addDays(today, -30),
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    await recordSale(
      team.manager,
      recordSaleSchema.parse({
        reservationId: saleId,
        signedOn: addDays(today, -10),
        notary: "Maître Kaci",
        reference: "",
      }),
    );

    expect(await importSaleBuyers(manager, residenceId)).toEqual({ units: 1, coOwners: 2 });
    expect(await importSaleBuyers(manager, residenceId)).toEqual({ units: 0, coOwners: 0 });
    const sold = (await getResidence(manager, residenceId))?.units[0]?.residents;
    expect(sold?.map((r) => [r.firstName, r.kind, r.isMain, r.sinceOn])).toEqual([
      ["Yasmine", "co_owner", true, addDays(today, -10)],
      ["Nassim", "co_owner", false, addDays(today, -10)],
    ]);

    const add = (unitId: string, overrides: Record<string, unknown>) =>
      addResident(
        manager,
        addResidentSchema.parse({
          residenceId,
          unitId,
          kind: "co_owner",
          isMain: true,
          lastName: "Bouzid",
          firstName: "Selma",
          phone: "0661 22 33 44",
          ...overrides,
        }),
      );
    const owner = await add(unitIds[1], { sinceOn: addDays(today, -400) });
    await add(unitIds[1], { kind: "occupant", lastName: "Hadj", firstName: "Omar" });
    await expect(add("00000000-0000-7000-8000-000000000000", {})).rejects.toMatchObject({
      messageKey: "residences.errors.unitNotInResidence",
    });

    await expect(
      endResident(manager, { residentId: owner.id, untilOn: addDays(today, -500) }),
    ).rejects.toMatchObject({ messageKey: "residences.errors.endBeforeStart" });
    await endResident(manager, { residentId: owner.id, untilOn: addDays(today, -1) });
    await expect(
      endResident(manager, { residentId: owner.id, untilOn: today }),
    ).rejects.toMatchObject({ messageKey: "residences.errors.alreadyEnded" });
    const next = await add(unitIds[1], { lastName: "Khelifi", firstName: "Nabil", sinceOn: today });

    const current = (await getResidence(manager, residenceId))?.units[1]?.residents;
    expect(current?.map((r) => [r.lastName, r.kind])).toEqual([
      ["Khelifi", "co_owner"],
      ["Hadj", "occupant"],
    ]);
    const history = await listUnitResidents(manager, residenceId, [unitIds[1]]);
    expect(history.map((r) => [r.id, r.untilOn])).toEqual(
      expect.arrayContaining([
        [owner.id, addDays(today, -1)],
        [next.id, null],
      ]),
    );
    const [row] = (await listResidences(manager)).filter((r) => r.id === residenceId);
    expect(row?.unitsWithCoOwner).toBe(2);
  });
});
