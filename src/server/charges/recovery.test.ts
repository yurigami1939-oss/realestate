import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { planLines, planProgress } from "@/lib/recovery";
import { createResidenceSchema, saveSharesSchema } from "@/server/residences/schemas";
import { createResidence, saveShares } from "@/server/residences/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { createChargeCategory } from "./categories";
import { recordChargePayment } from "./payments";
import { listOverdueCharges } from "./queries";
import {
  addRecoveryStep,
  cancelRepaymentPlan,
  closeRecovery,
  createRepaymentPlan,
  getUnitRecovery,
  openRecovery,
} from "./recovery";
import {
  addRecoveryStepSchema,
  createChargeCategorySchema,
  createRepaymentPlanSchema,
  issueWorksCallSchema,
  recordChargePaymentSchema,
} from "./schemas";
import { issueWorksCall } from "./works";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("recovery of charge arrears", () => {
  it("spreads a plan in equal months and measures it against the payments", () => {
    const lines = planLines(100_000n, 3, "2026-01-31");
    expect(lines).toEqual([
      { dueOn: "2026-01-31", amount: 33_334n },
      { dueOn: "2026-02-28", amount: 33_333n },
      { dueOn: "2026-03-31", amount: 33_333n },
    ]);
    expect(planProgress(lines, 0n, "2026-02-28")).toMatchObject({ due: 66_667n, late: 66_667n });
    expect(planProgress(lines, 70_000n, "2026-02-28")).toMatchObject({ late: 0n, done: false });
    expect(planProgress(lines, 200_000n, "2026-02-28")).toMatchObject({
      paid: 100_000n,
      done: true,
    });
  });

  it("opens a file, records its steps and a repayment plan, then closes it", async () => {
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
    // A call due ten days ago: the first unit owes 400 000 DA.
    await issueWorksCall(
      manager,
      issueWorksCallSchema.parse({
        residenceId,
        title: "Ravalement",
        titleAr: "",
        categoryId,
        amount: "1 000 000",
        issuedOn: addDays(today, -40),
        dueOn: addDays(today, -10),
        resolutionId: "",
      }),
    );
    const unitId = setup.unitIds[0] ?? "";

    await expect(openRecovery(team.agentA, { residenceId, unitId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { id: recoveryId } = await openRecovery(manager, { residenceId, unitId });
    await expect(openRecovery(manager, { residenceId, unitId })).rejects.toMatchObject({
      messageKey: "charges.recovery.errors.alreadyOpen",
    });
    const step = (overrides: Record<string, string>) =>
      addRecoveryStepSchema.parse({
        recoveryId,
        kind: "formal_notice",
        doneOn: today,
        note: "",
        ...overrides,
      });
    await expect(
      addRecoveryStep(manager, step({ doneOn: addDays(today, 1) })),
    ).rejects.toMatchObject({ messageKey: "charges.errors.futureDate" });
    await addRecoveryStep(manager, step({ note: "Remise en main propre" }));

    const plan = (overrides: Record<string, string>) =>
      createRepaymentPlanSchema.parse({
        recoveryId,
        total: "400 000",
        months: "4",
        firstDueOn: today,
        ...overrides,
      });
    await expect(createRepaymentPlan(manager, plan({ total: "500 000" }))).rejects.toMatchObject({
      messageKey: "charges.recovery.errors.aboveOverdue",
    });
    await expect(
      createRepaymentPlan(manager, plan({ firstDueOn: addDays(today, -1) })),
    ).rejects.toMatchObject({ messageKey: "charges.recovery.errors.pastStart" });
    const { id: planId } = await createRepaymentPlan(manager, plan({}));

    // The first installment is due today and nothing was paid: late by 100 000 DA.
    const before = await getUnitRecovery(manager, residenceId, unitId);
    expect(before?.plan?.lines.map((l) => l.amount)).toEqual([
      10_000_000n,
      10_000_000n,
      10_000_000n,
      10_000_000n,
    ]);
    expect(before?.plan?.progress).toMatchObject({ due: 10_000_000n, late: 10_000_000n });
    await recordChargePayment(
      cashier,
      recordChargePaymentSchema.parse({
        residenceId,
        unitId,
        amount: "100 000",
        method: "cash",
        paidOn: today,
        payerName: "Copropriétaire",
      }),
    );
    expect((await getUnitRecovery(manager, residenceId, unitId))?.plan?.progress).toMatchObject({
      paid: 10_000_000n,
      late: 0n,
    });
    const overdue = (await listOverdueCharges(manager)).find((r) => r.unitId === unitId);
    expect(overdue?.recovery).toEqual({ lastStep: "formal_notice", planLate: false });

    await cancelRepaymentPlan(manager, { planId, reason: "Renégocié" });
    await closeRecovery(manager, { recoveryId, reason: "Arriéré réglé" });
    expect(await getUnitRecovery(manager, residenceId, unitId)).toBeNull();
    await expect(addRecoveryStep(manager, step({}))).rejects.toMatchObject({
      messageKey: "charges.recovery.errors.closed",
    });
    const actions = await withTenant(manager, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, residenceId)),
    );
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "charge_recovery.open",
        "charge_recovery.step",
        "charge_recovery.plan",
        "charge_recovery.plan_cancel",
        "charge_recovery.close",
      ]),
    );
  });
});
