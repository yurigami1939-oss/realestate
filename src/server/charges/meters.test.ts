import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, chargeCall } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { categoryWeights, consumptionLitres } from "@/lib/charges";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createResidenceSchema } from "@/server/residences/schemas";
import { createResidence } from "@/server/residences/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { createChargeCategory } from "./categories";
import { deleteMeterReading, getMeterBoard, saveMeterReadings } from "./meters";
import {
  createChargeCategorySchema,
  issueWorksCallSchema,
  saveMeterReadingsSchema,
} from "./schemas";
import { issueWorksCall } from "./works";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("water meters and consumption-based charges", () => {
  it("measures consumption in litres and weighs the units read twice", () => {
    expect(consumptionLitres("100.5", "112.25")).toBe(11_750n);
    expect(consumptionLitres("100", "100")).toBe(0n);
    expect(consumptionLitres("120", "100")).toBe(0n);
    const units = [
      { unitId: "a", buildingId: "b", share: 100, consumption: 12_500n },
      { unitId: "b", buildingId: "b", share: 100, consumption: null },
      { unitId: "c", buildingId: "b", share: 100, consumption: 0n },
    ];
    expect(
      categoryWeights(
        {
          id: "water",
          name: "Eau",
          nameAr: null,
          key: "consumption",
          weighting: "share",
          buildingId: null,
          unitIds: [],
        },
        units,
      ),
    ).toEqual([
      { unitId: "a", weight: 12_500n },
      { unitId: "c", weight: 0n },
    ]);
  });

  it("records readings and splits a water bill by consumption", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const manager = await addMember(team.orgId, ["property_manager"]);
    const [first, second, third] = setup.unitIds;
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
    const campaign = (readOn: string, readings: [string, string][]) =>
      saveMeterReadingsSchema.parse({
        residenceId,
        readOn,
        readings: readings.map(([unitId, reading]) => ({ unitId, reading })),
      });

    await expect(
      saveMeterReadings(team.agentA, campaign(today, [[first, "100"]])),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      saveMeterReadings(manager, campaign(addDays(today, 1), [[first, "100"]])),
    ).rejects.toMatchObject({ messageKey: "charges.errors.futureDate" });
    await expect(saveMeterReadings(manager, campaign(today, [[first, ""]]))).rejects.toMatchObject({
      messageKey: "charges.meters.errors.nothingRead",
    });
    expect(() => campaign(today, [[first, "12,3456"]])).toThrow();

    await saveMeterReadings(
      manager,
      campaign(addDays(today, -90), [
        [first, "100"],
        [second, "200,5"],
        [third, "50"],
      ]),
    );
    // The meter never goes back.
    await expect(
      saveMeterReadings(manager, campaign(today, [[first, "99"]])),
    ).rejects.toMatchObject({ messageKey: "charges.meters.errors.backwards" });
    await saveMeterReadings(
      manager,
      campaign(today, [
        [first, "112,5"],
        [second, "230,5"],
      ]),
    );
    const board = await getMeterBoard(manager, residenceId);
    expect(board?.units.map((u) => [u.code, u.consumption])).toEqual([
      ["A-03-01", 12_500n],
      ["A-03-02", 30_000n],
      ["A-04-01", null],
    ]);

    // A water bill of 42 000 DA split by consumption: the third unit was read once only.
    const { id: categoryId } = await createChargeCategory(
      manager,
      createChargeCategorySchema.parse({
        residenceId,
        name: "Eau froide",
        nameAr: "",
        key: "consumption",
        weighting: "share",
        buildingId: "",
        unitIds: [],
      }),
    );
    const { periodId } = await issueWorksCall(
      manager,
      issueWorksCallSchema.parse({
        residenceId,
        title: "Facture d'eau du trimestre",
        titleAr: "",
        categoryId,
        amount: "42 000",
        issuedOn: today,
        dueOn: addDays(today, 30),
        resolutionId: "",
      }),
    );
    const calls = await withTenant(manager, (tx) =>
      tx
        .select({ unitId: chargeCall.unitId, amount: chargeCall.amount })
        .from(chargeCall)
        .where(eq(chargeCall.periodId, periodId)),
    );
    expect(new Map(calls.map((c) => [c.unitId, c.amount]))).toEqual(
      new Map([
        [first, 1_235_294n],
        [second, 2_964_706n],
      ]),
    );

    const typo = board?.units.find((u) => u.code === "A-03-02")?.last?.id ?? "";
    await deleteMeterReading(manager, { readingId: typo });
    expect(
      (await getMeterBoard(manager, residenceId))?.units.find((u) => u.code === "A-03-02")
        ?.consumption,
    ).toBeNull();
    const audits = await withTenant(manager, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, residenceId), like(auditLog.action, "meter_reading.%"))),
    );
    expect(audits.map((a) => a.action).sort()).toEqual([
      "meter_reading.delete",
      "meter_reading.save",
      "meter_reading.save",
    ]);
  });
});
