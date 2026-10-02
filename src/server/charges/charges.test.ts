import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, chargeCall, chargeCallLine } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createBuildingSchema, createProjectSchema } from "@/server/inventory/schemas";
import { createBuilding, createProject } from "@/server/inventory/service";
import {
  addResidentSchema,
  createResidenceSchema,
  saveSharesSchema,
} from "@/server/residences/schemas";
import { addResident, createResidence, saveShares } from "@/server/residences/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { approveBudget, saveBudget } from "./budgets";
import { cancelChargePeriod, issueChargePeriod } from "./calls";
import { createChargeCategory, deleteChargeCategory, updateChargeCategory } from "./categories";
import { chargeCallHtml, loadChargeCallData, renderAndStoreChargeCall } from "./documents";
import { getCallsSetup, getChargePeriod, getChargesSetup } from "./queries";
import {
  cancelChargePeriodSchema,
  createChargeCategorySchema,
  issueChargePeriodSchema,
  saveBudgetSchema,
  updateChargeCategorySchema,
} from "./schemas";

const today = todayInAlgiers();

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

/** The scenario with an approved 2026 budget: cleaning 400 000 DA (tantièmes), guarding 120 000 DA (equal). */
async function budgetScenario() {
  const base = await scenario();
  const { manager, residenceId } = base;
  const { id: cleaning } = await createChargeCategory(manager, categoryInput(residenceId));
  const { id: guarding } = await createChargeCategory(
    manager,
    categoryInput(residenceId, { name: "Gardiennage", nameAr: "الحراسة", key: "equal" }),
  );
  const { budgetId } = await saveBudget(
    manager,
    saveBudgetSchema.parse({
      residenceId,
      year: "2026",
      lines: [
        { categoryId: cleaning, amount: "400 000" },
        { categoryId: guarding, amount: "120 000" },
      ],
      notes: "",
    }),
  );
  await approveBudget(manager, budgetId);
  return { ...base, budgetId };
}

const coOwner = (residenceId: string, unitId: string, lastName: string, isMain: boolean) =>
  addResidentSchema.parse({
    residenceId,
    unitId,
    kind: "co_owner",
    isMain,
    lastName,
    firstName: "Yasmine",
    lastNameAr: "سعيدي",
    firstNameAr: "ياسمين",
    sinceOn: "2026-01-01",
  });

describe("charge calls", () => {
  it("are issued per period to the units' main co-owners, numbered and immutable", async () => {
    const { team, manager, residenceId, budgetId, unitIds } = await budgetScenario();
    const accountant = await addMember(team.orgId, ["accountant"]);
    await addResident(manager, coOwner(residenceId, unitIds[0], "Saïdi", true));
    await addResident(manager, coOwner(residenceId, unitIds[1], "Benali", false));

    const input = (index: number, issuedOn = today, dueOn = addDays(today, 30)) =>
      issueChargePeriodSchema.parse({ period: `${budgetId}:${index}`, issuedOn, dueOn });
    await expect(issueChargePeriod(accountant, input(2))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      issueChargePeriod(manager, input(2, addDays(today, 1), addDays(today, 30))),
    ).rejects.toMatchObject({ messageKey: "charges.errors.futureDate" });
    await expect(
      issueChargePeriod(manager, input(2, today, addDays(today, -1))),
    ).rejects.toMatchObject({ messageKey: "charges.errors.dueBeforeIssue" });
    await expect(issueChargePeriod(manager, input(5))).rejects.toMatchObject({
      messageKey: "charges.errors.periodOutOfRange",
    });

    // Quarter 2: cleaning 100 000 (4/3/3), guarding 30 000 (equal), reserve 5 % of 520 000 / 4.
    const { periodId, calls, total } = await issueChargePeriod(manager, input(2));
    expect({ calls, total }).toEqual({ calls: 3, total: 136_500_00n });
    await expect(issueChargePeriod(manager, input(2))).rejects.toMatchObject({
      messageKey: "charges.errors.periodIssued",
    });

    const period = await getChargePeriod(accountant, periodId);
    const year = today.slice(0, 4);
    expect(
      period?.calls.map((c) => [c.number, c.unitCode, c.addresseeName, c.amount, c.reserve]),
    ).toEqual([
      [`ADC-${year}-000001`, "A-03-01", "Saïdi Yasmine", 52_600_00n, 2_600_00n],
      [`ADC-${year}-000002`, "A-03-02", "Benali Yasmine", 41_950_00n, 1_950_00n],
      [`ADC-${year}-000003`, "A-04-01", null, 41_950_00n, 1_950_00n],
    ]);
    const firstCall = period?.calls[0]?.id ?? "";
    const lines = await withTenant(team.owner, (tx) =>
      tx
        .select({ label: chargeCallLine.label, amount: chargeCallLine.amount })
        .from(chargeCallLine)
        .where(eq(chargeCallLine.callId, firstCall))
        .orderBy(chargeCallLine.position),
    );
    expect(lines).toEqual([
      { label: "Nettoyage", amount: 40_000_00n },
      { label: "Gardiennage", amount: 10_000_00n },
      { label: "Fonds de réserve", amount: 2_600_00n },
    ]);

    // The other quarters are still to issue.
    const setup = await getCallsSetup(manager, residenceId);
    expect(setup?.toIssue.map((p) => [p.periodIndex, p.calls, p.withoutCoOwner])).toEqual([
      [1, 3, 1],
      [3, 3, 1],
      [4, 3, 1],
    ]);

    // Issued calls are never edited or deleted.
    await expect(
      withTenant(team.owner, (tx) =>
        tx.update(chargeCall).set({ amount: 1n }).where(eq(chargeCall.id, firstCall)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(team.owner, (tx) => tx.delete(chargeCall).where(eq(chargeCall.id, firstCall))),
    ).rejects.toThrow();

    // Cancelling the period voids its calls; it can then be issued again.
    const cancel = cancelChargePeriodSchema.parse({ periodId, reason: "Tantièmes erronés" });
    await expect(cancelChargePeriod(manager, cancel)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await cancelChargePeriod(accountant, cancel);
    await expect(cancelChargePeriod(accountant, cancel)).rejects.toMatchObject({
      messageKey: "charges.errors.periodCancelled",
    });
    expect((await getChargePeriod(manager, periodId))?.status).toBe("cancelled");
    const again = await issueChargePeriod(manager, input(2));
    expect((await getChargePeriod(manager, again.periodId))?.calls[0]?.number).toBe(
      `ADC-${year}-000004`,
    );

    const audit = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "charge_period"), eq(auditLog.entityId, periodId))),
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      "charge_period.cancel",
      "charge_period.issue",
    ]);
  });

  it("render a bilingual charge call once", async () => {
    const { team, manager, residenceId, budgetId, unitIds } = await budgetScenario();
    await addResident(manager, coOwner(residenceId, unitIds[0], "Saïdi", true));
    const { periodId } = await issueChargePeriod(
      manager,
      issueChargePeriodSchema.parse({
        period: `${budgetId}:1`,
        issuedOn: today,
        dueOn: addDays(today, 30),
      }),
    );
    const callId = (await getChargePeriod(manager, periodId))?.calls[0]?.id ?? "";
    const loaded = await withTenant(team.owner, (tx) => loadChargeCallData(tx, callId));
    if (!loaded) throw new Error("charge call not found");
    expect(loaded.data).toMatchObject({
      period: { fr: "1er trimestre 2026", ar: "الثلاثي الأول 2026" },
      share: 4000,
      shareBasis: 10_000,
      addressee: { name: "Saïdi Yasmine", nameAr: "سعيدي ياسمين" },
    });
    const html = chargeCallHtml(loaded.data, {
      name: "Promo",
      legalName: "SARL Promo",
      address: null,
      wilaya: null,
      phone: null,
      rcNumber: null,
      nif: null,
      nis: null,
      aiNumber: null,
      logo: null,
    });
    expect(html).toContain("APPEL DE CHARGES");
    expect(html).toContain("طلب تسديد الأعباء");
    expect(html).toContain("cinquante-deux mille six cents dinars");

    expect(await renderAndStoreChargeCall(team.orgId, callId)).toBe("stored");
    expect(await renderAndStoreChargeCall(team.orgId, callId)).toBe("skipped");
    expect((await getChargePeriod(manager, periodId))?.calls[0]?.pdfFileId).not.toBeNull();
  });
});
