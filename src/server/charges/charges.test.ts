import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createBuildingSchema, createProjectSchema } from "@/server/inventory/schemas";
import { createBuilding, createProject } from "@/server/inventory/service";
import { createResidenceSchema, saveSharesSchema } from "@/server/residences/schemas";
import { createResidence, saveShares } from "@/server/residences/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { approveBudget, saveBudget } from "./budgets";
import { createChargeCategory, deleteChargeCategory, updateChargeCategory } from "./categories";
import { getChargesSetup } from "./queries";
import {
  createChargeCategorySchema,
  saveBudgetSchema,
  updateChargeCategorySchema,
} from "./schemas";

/** A residence of three units (A-03-01, A-03-02, A-04-01) at 4000 / 3000 / 3000 tantièmes. */
async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const manager = await addMember(team.orgId, ["property_manager"]);
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
  return { team, ...setup, manager, residenceId };
}

const categoryInput = (residenceId: string, overrides: Record<string, unknown> = {}) =>
  createChargeCategorySchema.parse({
    residenceId,
    name: "Nettoyage",
    nameAr: "التنظيف",
    key: "share",
    weighting: "share",
    buildingId: "",
    unitIds: [],
    ...overrides,
  });

describe("charge categories", () => {
  it("split by a key checked against the residence", async () => {
    const { team, manager, residenceId, buildingId, unitIds } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);

    await expect(createChargeCategory(cashier, categoryInput(residenceId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { id: cleaning } = await createChargeCategory(manager, categoryInput(residenceId));
    const { id: lift } = await createChargeCategory(
      manager,
      categoryInput(residenceId, { name: "Ascenseur A", key: "per_building", buildingId }),
    );
    await createChargeCategory(
      manager,
      categoryInput(residenceId, {
        name: "Jardin",
        key: "custom",
        weighting: "equal",
        unitIds: [unitIds[0], unitIds[2]],
      }),
    );

    // A building or a unit from elsewhere is refused.
    const { id: otherProject } = await createProject(
      team.owner,
      createProjectSchema.parse({ code: "CORN", name: "Corniche", status: "planning" }),
    );
    const { id: otherBuilding } = await createBuilding(
      team.owner,
      createBuildingSchema.parse({
        projectId: otherProject,
        code: "C",
        name: "Bloc C",
        lowestFloor: "0",
        topFloor: "3",
      }),
    );
    await expect(
      createChargeCategory(
        manager,
        categoryInput(residenceId, { key: "per_building", buildingId: otherBuilding }),
      ),
    ).rejects.toMatchObject({ messageKey: "charges.errors.buildingNotInResidence" });
    await expect(
      createChargeCategory(
        manager,
        categoryInput(residenceId, {
          key: "custom",
          unitIds: ["00000000-0000-7000-8000-000000000000"],
        }),
      ),
    ).rejects.toMatchObject({ messageKey: "residences.errors.unitNotInResidence" });
    expect(() => categoryInput(residenceId, { key: "custom", unitIds: [] })).toThrow();

    await updateChargeCategory(
      manager,
      updateChargeCategorySchema.parse({
        categoryId: lift,
        name: "Ascenseur",
        nameAr: "",
        key: "equal",
        weighting: "share",
        buildingId: buildingId,
        unitIds: [],
      }),
    );
    const setup = await getChargesSetup(cashier, residenceId, 2026);
    expect(setup?.categories.map((c) => [c.name, c.key, c.buildingId, c.unitIds.length])).toEqual([
      ["Nettoyage", "share", null, 0],
      ["Ascenseur", "equal", null, 0],
      ["Jardin", "custom", null, 2],
    ]);

    const audit = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "charge_category"), eq(auditLog.entityId, cleaning))),
    );
    expect(audit.map((a) => a.action)).toEqual(["charge_category.create"]);
  });
});

describe("budgets", () => {
  it("are drafted per year, approved once and frozen", async () => {
    const { team, manager, residenceId } = await scenario();
    const { id: cleaning } = await createChargeCategory(manager, categoryInput(residenceId));
    const { id: guarding } = await createChargeCategory(
      manager,
      categoryInput(residenceId, { name: "Gardiennage", key: "equal" }),
    );
    const { id: unused } = await createChargeCategory(
      manager,
      categoryInput(residenceId, { name: "Divers" }),
    );

    const budgetInput = (year: string, amounts: [string, string, string]) =>
      saveBudgetSchema.parse({
        residenceId,
        year,
        lines: [cleaning, guarding, unused].map((categoryId, index) => ({
          categoryId,
          amount: amounts[index],
        })),
        notes: "",
      });
    const { budgetId, total } = await saveBudget(
      manager,
      budgetInput("2026", ["400 000", "120 000", ""]),
    );
    expect(total).toBe(520_000_00n);
    // Saving again replaces the amounts.
    await saveBudget(manager, budgetInput("2026", ["480 000", "120 000", "0"]));
    let setup = await getChargesSetup(manager, residenceId, 2026);
    expect(setup?.budget).toMatchObject({ status: "draft", frequency: null });
    expect(setup?.lines.map((l) => l.amount).sort()).toEqual([120_000_00n, 480_000_00n]);

    await approveBudget(manager, budgetId);
    setup = await getChargesSetup(manager, residenceId, 2026);
    expect(setup?.budget).toMatchObject({
      status: "approved",
      frequency: "quarterly",
      reserveFundBp: 500,
    });
    await expect(saveBudget(manager, budgetInput("2026", ["1", "1", "1"]))).rejects.toMatchObject({
      messageKey: "charges.errors.budgetApproved",
    });
    await expect(approveBudget(manager, budgetId)).rejects.toMatchObject({ code: "CONFLICT" });

    // A category called by an approved budget stays; an unused one goes.
    await expect(deleteChargeCategory(manager, cleaning)).rejects.toMatchObject({
      messageKey: "charges.errors.categoryInBudget",
    });
    await deleteChargeCategory(manager, unused);

    // Next year starts from the approved amounts; an empty budget cannot be approved.
    setup = await getChargesSetup(manager, residenceId, 2027);
    expect(setup?.budget).toBeNull();
    expect(setup?.amountsFrom).toBe(2026);
    const { budgetId: empty } = await saveBudget(
      manager,
      saveBudgetSchema.parse({ residenceId, year: "2027", lines: [], notes: "" }),
    );
    await expect(approveBudget(manager, empty)).rejects.toMatchObject({
      messageKey: "charges.errors.emptyBudget",
    });

    const audit = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "budget"), eq(auditLog.entityId, budgetId))),
    );
    expect(audit).toMatchObject([
      {
        action: "budget.approve",
        after: { year: 2026, total: "60000000", frequency: "quarterly" },
      },
    ]);
  });
});
