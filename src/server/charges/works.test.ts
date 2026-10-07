import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { assemblyResolution, chargeCall, chargePeriod, generalAssembly } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { addResolutionSchema, createAssemblySchema } from "@/server/assemblies/schemas";
import { addResolution, createAssembly } from "@/server/assemblies/service";
import { createResidenceSchema, saveSharesSchema } from "@/server/residences/schemas";
import { createResidence, saveShares } from "@/server/residences/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { createChargeCategory } from "./categories";
import { loadChargeCallData } from "./documents";
import { getUnitAccount } from "./queries";
import { getBudgetReport } from "./report";
import { createChargeCategorySchema, issueWorksCallSchema } from "./schemas";
import { getWorksCallChoices, issueWorksCall } from "./works";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("exceptional calls for works", () => {
  it("split a voted works amount by a category's key, called once", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const manager = await addMember(team.orgId, ["property_manager"]);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const { id: residenceId } = await createResidence(
      manager,
      createResidenceSchema.parse({
        projectId: setup.projectId,
        name: "Résidence Les Oliviers",
        shareBasis: "10000",
        chargeFrequency: "quarterly",
        reserveFund: "5",
        callDueDays: "30",
      }),
    );
    await saveShares(
      manager,
      saveSharesSchema.parse({
        residenceId,
        shares: setup.unitIds.map((unitId, index) => ({
          unitId,
          share: index === 0 ? "4000" : "3000",
        })),
      }),
    );
    const { id: categoryId } = await createChargeCategory(
      manager,
      createChargeCategorySchema.parse({
        residenceId,
        name: "Travaux",
        nameAr: "",
        key: "share",
        weighting: "share",
        buildingId: "",
        unitIds: [],
      }),
    );
    // An assembly voted the works; its resolution counts once adopted and the assembly closed.
    const { id: assemblyId } = await createAssembly(
      manager,
      createAssemblySchema.parse({
        residenceId,
        kind: "extraordinary",
        heldOn: addDays(today, -20),
        startTime: "18:00",
        place: "Hall",
        notes: "",
      }),
    );
    const { id: resolutionId } = await addResolution(
      manager,
      addResolutionSchema.parse({
        assemblyId,
        title: "Étanchéité de la terrasse",
        titleAr: "",
        description: "",
        majority: "two_thirds",
      }),
    );
    const input = (overrides: Record<string, string> = {}) =>
      issueWorksCallSchema.parse({
        residenceId,
        title: "Étanchéité de la terrasse",
        titleAr: "تسرب المياه في السطح",
        categoryId,
        amount: "1 000 000",
        issuedOn: today,
        dueOn: addDays(today, 30),
        resolutionId,
        ...overrides,
      });
    await expect(issueWorksCall(cashier, input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(issueWorksCall(manager, input())).rejects.toMatchObject({
      messageKey: "charges.errors.resolutionNotAdopted",
    });
    await withTenant(manager, async (tx) => {
      await tx
        .update(generalAssembly)
        .set({ status: "closed", closedAt: new Date(), totalShares: 10_000 })
        .where(eq(generalAssembly.id, assemblyId));
      await tx
        .update(assemblyResolution)
        .set({ adopted: true })
        .where(eq(assemblyResolution.id, resolutionId));
    });
    expect((await getWorksCallChoices(manager, residenceId)).resolutions).toMatchObject([
      { id: resolutionId, position: 1 },
    ]);
    await expect(
      issueWorksCall(manager, input({ issuedOn: addDays(today, 1), dueOn: addDays(today, 30) })),
    ).rejects.toMatchObject({ messageKey: "charges.errors.futureDate" });

    const { periodId, calls, total } = await issueWorksCall(manager, input());
    expect({ calls, total }).toEqual({ calls: 3, total: 100_000_000n });
    const rows = await withTenant(manager, (tx) =>
      tx
        .select({ amount: chargeCall.amount, reserve: chargeCall.reserve, id: chargeCall.id })
        .from(chargeCall)
        .where(eq(chargeCall.periodId, periodId))
        .orderBy(chargeCall.number),
    );
    expect(rows.map((r) => [r.amount, r.reserve])).toEqual([
      [40_000_000n, 0n],
      [30_000_000n, 0n],
      [30_000_000n, 0n],
    ]);
    const [period] = await withTenant(manager, (tx) =>
      tx.select().from(chargePeriod).where(eq(chargePeriod.id, periodId)),
    );
    expect(period).toMatchObject({ kind: "works", budgetId: null, resolutionId, categoryId });

    // Printed with its title; in the unit's account; called in its category this year.
    const printed = await withTenant(manager, (tx) => loadChargeCallData(tx, rows[0]?.id ?? ""));
    expect(printed?.data.period).toEqual({
      fr: "Étanchéité de la terrasse",
      ar: "تسرب المياه في السطح",
    });
    const account = await getUnitAccount(manager, residenceId, setup.unitIds[0] ?? "");
    expect(account?.statement.lines.map((l) => [l.title, l.amount])).toEqual([
      ["Étanchéité de la terrasse", 40_000_000n],
    ]);
    const report = await getBudgetReport(manager, residenceId, Number(today.slice(0, 4)));
    expect(report?.lines.find((l) => l.categoryId === categoryId)).toMatchObject({
      called: 100_000_000n,
    });
  });
});
