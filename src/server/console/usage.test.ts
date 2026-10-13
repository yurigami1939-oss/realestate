import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { consoleDb } from "@/db/console-client";
import { tenantUsage, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { getUsage, readMeasuredCapacity } from "@/server/entitlements/capacity";
import { type ExportValue, buildWorkbook } from "@/server/exports/xlsx";
import { runImport } from "@/server/imports/service";
import { setUnitFloorPlan } from "@/server/inventory/floor-plans";
import {
  createBuildingSchema,
  createProjectSchema,
  createUnitSchema,
  generateUnitsSchema,
  unitStatusReasonSchema,
  updateUnitPriceSchema,
} from "@/server/inventory/schemas";
import {
  blockUnit,
  createBuilding,
  createProject,
  createUnit,
  deleteUnit,
  generateUnits,
  updateUnitPrice,
} from "@/server/inventory/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { createResidenceSchema } from "@/server/residences/schemas";
import { createResidence } from "@/server/residences/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { createTestPlan, openTestAccount } from "../../../tests/console-fixtures";
import { addMember, createOrganization, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { systemOperator } from "./context";
import { getAccount, getConsoleOverview } from "./queries";
import { pruneUsage, snapshotOrganization } from "./usage";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

/** A project of the organization with one building of floors 0 to 9. */
async function building(
  ctx: TenantCtx,
  code: string,
  values: { status?: string; thirdParty?: boolean } = {},
) {
  const { id: projectId } = await createProject(
    ctx,
    createProjectSchema.parse({ code, name: `Résidence ${code}`, status: "planning", ...values }),
  );
  const { id: buildingId } = await createBuilding(
    ctx,
    createBuildingSchema.parse({
      projectId,
      code: "A",
      name: "Bloc A",
      lowestFloor: "0",
      topFloor: "9",
    }),
  );
  return { projectId, buildingId };
}

/** `perFloor` units on each floor from `from` to `to`. */
const generate = (ctx: TenantCtx, buildingId: string, from: number, to: number, perFloor = 1) =>
  generateUnits(
    ctx,
    generateUnitsSchema.parse({
      buildingId,
      fromFloor: String(from),
      toFloor: String(to),
      unitsPerFloor: String(perFloor),
      type: "apartment",
      typology: "F3",
      livingArea: "",
    }),
  );

const oneUnit = (ctx: TenantCtx, buildingId: string, code: string, floor = "9") =>
  createUnit(
    ctx,
    createUnitSchema.parse({
      buildingId,
      code,
      floor,
      type: "apartment",
      isDuplex: false,
      orientations: [],
    }),
  );

/** A snapshot written as the nightly job would. */
const measured = (
  organizationId: string,
  values: Partial<typeof tenantUsage.$inferInsert> = {},
  measuredOn = today,
) =>
  consoleDb.insert(tenantUsage).values({
    organizationId,
    measuredOn,
    projects: 1,
    units: 0,
    activeUnits: 0,
    managedLots: 0,
    staffMembers: 1,
    portalAccounts: 0,
    storageBytes: 0,
    receipts30d: 0,
    reminders30d: 0,
    activeMembers30d: 0,
    leads30d: 0,
    ...values,
  });

const planLimit = (cap: number) => ({
  code: "CONFLICT",
  messageKey: "errors.planLimit",
  details: { cap },
});

/** Two SARLs of one client on a plan of `cap` active units, each with its gérant. */
async function pooledAccount(cap: number) {
  const [a, b] = await Promise.all([
    createOrganization({}, { entitle: false }),
    createOrganization({}, { entitle: false }),
  ]);
  const planCode = await createTestPlan({ activeUnits: String(cap) });
  const { billingAccountId } = await openTestAccount([a.id, b.id], { planCode });
  const [ownerA, ownerB] = await Promise.all([
    addMember(a.id, ["owner"]),
    addMember(b.id, ["owner"]),
  ]);
  return { a, b, ownerA, ownerB, billingAccountId };
}

describe("usage snapshots (CLAUDE.console.md §7)", () => {
  it("measures an organization: active units, managed lots, accounts, storage and activity", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team); // OLIV: three units, planning
    const cashier = await addMember(team.orgId, ["cashier"]);
    await addMember(team.orgId, ["resident"]);

    // A delivered project's units are no longer active; they are managed once in a residence.
    const delivered = await building(team.owner, "LIVR", { status: "delivered" });
    await generate(team.owner, delivered.buildingId, 1, 2);
    await createResidence(
      team.owner,
      createResidenceSchema.parse({
        projectId: delivered.projectId,
        name: "Résidence Livrée",
        address: "",
        commune: "",
        wilaya: "",
        shareBasis: "10000",
        chargeFrequency: "quarterly",
        reserveFund: "0",
        callDueDays: "30",
        notes: "",
      }),
    );
    // A deleted unit counts nowhere.
    const gone = await building(team.owner, "GONE");
    const { id: goneId } = await oneUnit(team.owner, gone.buildingId, "A-09-01");
    await deleteUnit(team.owner, { unitId: goneId });

    // A floor plan's bytes are the storage.
    const plan = new TextEncoder().encode("%PDF-1.7\nplan\n%%EOF");
    await setUnitFloorPlan(team.manager, {
      unitId: setup.unitIds[0] ?? "",
      upload: { fileName: "plan.pdf", bytes: plan },
    });

    // The pilot's indicators: a receipt issued and a lead received.
    await newLead(team.manager);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0661 50 12 34",
        email: "",
        leadId: "",
      }),
    );
    const { id: saleId } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[1],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: today,
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount: "1 000 000",
        method: "cash",
        paidOn: today,
        reference: "",
        bank: "",
        payerName: "Bensalem Karim",
      }),
    );

    const usage = await snapshotOrganization(team.orgId);
    expect(usage).toMatchObject({
      projects: 3,
      units: 5,
      activeUnits: 3,
      managedLots: 2,
      // A gérant, a directeur commercial, two commercials and a cashier; one portal account.
      staffMembers: 5,
      portalAccounts: 1,
      storageBytes: plan.byteLength,
      receipts30d: 1,
      reminders30d: 0,
      leads30d: 1,
    });
    expect(usage.activeMembers30d).toBeGreaterThanOrEqual(3);
    expect(usage.lastActivityAt).toBeInstanceOf(Date);

    const [row] = await consoleDb
      .select()
      .from(tenantUsage)
      .where(eq(tenantUsage.organizationId, team.orgId));
    expect(row).toMatchObject({ measuredOn: today, activeUnits: 3, storageBytes: plan.byteLength });
  });

  it("keeps one snapshot a day and prunes them after 400 days", async () => {
    const org = await createOrganization();
    const owner = await addMember(org.id, ["owner"]);
    const { buildingId } = await building(owner, "DAYS");
    await snapshotOrganization(org.id);
    await generate(owner, buildingId, 1, 2);
    await snapshotOrganization(org.id);
    const rows = await consoleDb
      .select({ measuredOn: tenantUsage.measuredOn, activeUnits: tenantUsage.activeUnits })
      .from(tenantUsage)
      .where(eq(tenantUsage.organizationId, org.id));
    expect(rows).toEqual([{ measuredOn: today, activeUnits: 2 }]);

    // The next night adds a row (the job measures every organization the same way).
    const tomorrow = addDays(today, 1);
    await snapshotOrganization(org.id, tomorrow);
    const measuredTomorrow = await consoleDb
      .select({ activeUnits: tenantUsage.activeUnits })
      .from(tenantUsage)
      .where(and(eq(tenantUsage.organizationId, org.id), eq(tenantUsage.measuredOn, tomorrow)));
    expect(measuredTomorrow).toEqual([{ activeUnits: 2 }]);

    await measured(org.id, {}, addDays(today, -401));
    await measured(org.id, {}, addDays(today, -400));
    await pruneUsage(today);
    const kept = await consoleDb
      .select({ measuredOn: tenantUsage.measuredOn })
      .from(tenantUsage)
      .where(eq(tenantUsage.organizationId, org.id))
      .orderBy(tenantUsage.measuredOn);
    expect(kept.map((r) => r.measuredOn)).toEqual([addDays(today, -400), today, tomorrow]);
  });

  it("gives the app its own account's figures only, through tenant_capacity()", async () => {
    const { a, b } = await pooledAccount(1000);
    const c = await createOrganization({}, { entitle: false });
    await openTestAccount([c.id]);
    await measured(a.id, { activeUnits: 3, managedLots: 4, storageBytes: 1_000 });
    // The latest snapshot counts, not an older one.
    await measured(b.id, { activeUnits: 99 }, addDays(today, -1));
    await measured(b.id, { activeUnits: 6, managedLots: 1, storageBytes: 500 });
    await measured(c.id, { activeUnits: 50, managedLots: 7, storageBytes: 9_000 });

    expect(await withTenant({ orgId: a.id }, (tx) => readMeasuredCapacity(tx))).toEqual({
      othersActiveUnits: 6,
      activeUnits: 9,
      managedLots: 5,
      storageBytes: 1_500,
      measuredOn: today,
    });
    expect(await withTenant({ orgId: c.id }, (tx) => readMeasuredCapacity(tx))).toMatchObject({
      othersActiveUnits: 0,
      activeUnits: 50,
      managedLots: 7,
    });
    // An organization without account, or no organization set: nothing.
    const alone = await createOrganization({}, { entitle: false });
    expect(await withTenant({ orgId: alone.id }, (tx) => readMeasuredCapacity(tx))).toEqual({
      othersActiveUnits: 0,
      activeUnits: 0,
      managedLots: 0,
      storageBytes: 0,
      measuredOn: null,
    });
    const { rows } = await db.execute<{ data: { activeUnits: number } }>(
      sql`select console.tenant_capacity() as data`,
    );
    expect(rows[0]?.data.activeUnits).toBe(0);
    // The app never reads the console's table itself.
    await expect(db.select().from(tenantUsage)).rejects.toThrow();
  });
});

describe("the pooled cap of active units (CLAUDE.console.md §7)", () => {
  it("counts this organization live and the others as measured, when adding units only", async () => {
    const { b, ownerA, ownerB } = await pooledAccount(10);
    const inB = await building(ownerB, "BBBB");
    await generate(ownerB, inB.buildingId, 1, 2, 3); // six units in the other SARL
    await snapshotOrganization(b.id);

    const { buildingId, projectId } = await building(ownerA, "AAAA");
    await expect(generate(ownerA, buildingId, 1, 5)).rejects.toMatchObject(planLimit(10));
    const none = await withTenant(ownerA, (tx) =>
      tx.select({ id: unit.id }).from(unit).where(eq(unit.projectId, projectId)),
    );
    expect(none).toEqual([]);
    await generate(ownerA, buildingId, 1, 4); // 6 + 4 = 10: the cap is reached, not passed
    await expect(oneUnit(ownerA, buildingId, "A-09-01")).rejects.toMatchObject(planLimit(10));

    // What runs on existing units never meets the cap.
    const [first] = await withTenant(ownerA, (tx) =>
      tx.select({ id: unit.id }).from(unit).where(eq(unit.projectId, projectId)),
    );
    const unitId = first?.id ?? "";
    await updateUnitPrice(
      ownerA,
      updateUnitPriceSchema.parse({ unitId, price: "9 000 000", reason: "Lancement" }),
    );
    await blockUnit(ownerA, unitStatusReasonSchema.parse({ unitId, reason: "Gardé" }));
    // Nor do a third party's units (delivered from the start).
    const managed = await building(ownerA, "TIER", { thirdParty: true });
    await oneUnit(ownerA, managed.buildingId, "A-01-01", "1");

    // The live count follows at once: a unit removed makes room.
    await deleteUnit(ownerA, { unitId });
    await oneUnit(ownerA, buildingId, "A-09-01");

    // The subscription page: this organization live, the other as measured.
    expect(await getUsage(ownerA)).toMatchObject({ activeUnits: 10, measuredOn: today });
  });

  it("blocks a units import beyond the cap before anything is written", async () => {
    const { ownerA } = await pooledAccount(3);
    const { buildingId, projectId } = await building(ownerA, "IMPO");
    await generate(ownerA, buildingId, 1, 2);
    const file = await buildWorkbook(
      [
        {
          name: "Lots",
          columns: ["Bâtiment", "Code lot", "Étage", "Type", "Typologie"].map((header) => ({
            header,
          })),
          rows: [
            ["A", "A-05-01", 5, "Appartement", "F3"],
            ["A", "A-06-01", 6, "Appartement", "F3"],
          ] satisfies ExportValue[][],
        },
      ],
      { rightToLeft: false },
    );
    const checked = await runImport(ownerA, "units", file, { projectId, commit: true });
    expect(checked.committed).toBe(false);
    expect(checked.issues).toMatchObject([
      { row: null, messageKey: "errors.planLimit", values: { cap: 3 } },
    ]);
    const units = await withTenant(ownerA, (tx) =>
      tx.select({ id: unit.id }).from(unit).where(eq(unit.projectId, projectId)),
    );
    expect(units).toHaveLength(2);
  });
});

describe("usage on the console (CLAUDE.console.md §10)", () => {
  it("shows each organization's latest figures and lists the accounts beyond their caps", async () => {
    const { a, b, billingAccountId } = await pooledAccount(10);
    await measured(a.id, { activeUnits: 7, receipts30d: 12, leads30d: 4 });
    await measured(b.id, { activeUnits: 5, storageBytes: 150e9 }); // the plan allows 100 Go

    const account = await getAccount(systemOperator, billingAccountId);
    const usage = new Map(account?.usage.map((u) => [u.organizationId, u]));
    expect(usage.get(a.id)).toMatchObject({ activeUnits: 7, receipts30d: 12, leads30d: 4 });
    expect(usage.get(b.id)).toMatchObject({ activeUnits: 5, storageBytes: 150e9 });

    const { overUnits, overStorage } = await getConsoleOverview(systemOperator);
    expect(overUnits.find((o) => o.id === billingAccountId)).toMatchObject({
      activeUnits: 12,
      unitsCap: 10,
    });
    expect(overStorage.find((o) => o.id === billingAccountId)).toMatchObject({ storageGb: 100 });

    // Within its caps, an account is not listed.
    const within = await pooledAccount(10);
    await measured(within.a.id, { activeUnits: 10 });
    const again = await getConsoleOverview(systemOperator);
    expect(again.overUnits.some((o) => o.id === within.billingAccountId)).toBe(false);
  });
});
