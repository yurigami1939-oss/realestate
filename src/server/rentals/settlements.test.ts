import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, rentPayment } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { buildRentPeriods, provisionsOfYear, rentAccountLines } from "@/lib/rentals";
import { approveBudget, saveBudget } from "@/server/charges/budgets";
import { issueChargePeriod } from "@/server/charges/calls";
import { createChargeCategory } from "@/server/charges/categories";
import {
  createChargeCategorySchema,
  issueChargePeriodSchema,
  saveBudgetSchema,
} from "@/server/charges/schemas";
import { createResidenceSchema, saveSharesSchema } from "@/server/residences/schemas";
import { createResidence, saveShares } from "@/server/residences/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getLease } from "./queries";
import {
  cancelChargeSettlementSchema,
  createLeaseSchema,
  recordRentPaymentSchema,
  settleLeaseChargesSchema,
} from "./schemas";
import { createLease, recordRentPayment } from "./service";
import { cancelChargeSettlement, settleLeaseCharges } from "./settlements";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();
const year = Number(today.slice(0, 4));
const lastYear = year - 1;

describe("yearly settlement of a tenant's charges", () => {
  it("adds a balance due as a line of its own and a credit to the payments", () => {
    const periods = buildRentPeriods({
      startOn: "2025-07-01",
      durationMonths: 12,
      frequency: "quarterly",
      monthlyRent: 4_000_000n,
      monthlyCharges: 300_000n,
    });
    expect(provisionsOfYear(periods, 2025)).toBe(1_800_000n);
    const { lines, credit } = rentAccountLines(periods, [
      { year: 2025, balance: 250_000n, dueOn: "2026-02-15" },
      { year: 2026, balance: -100_000n, dueOn: "2026-08-01" },
    ]);
    expect(lines.at(-1)).toMatchObject({
      position: 5,
      amount: 250_000n,
      rent: 0n,
      months: 0,
      dueOn: "2026-02-15",
      settlementYear: 2025,
    });
    expect(credit).toBe(100_000n);
  });

  it("settles a year against the provisions, then cancels a credit", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const manager = await addMember(team.orgId, ["property_manager"]);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const unitId = setup.unitIds[0] ?? "";

    // The unit's residence called two quarters of last year: 24 000 DA each, reserve aside.
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
        shares: setup.unitIds.map((id, index) => ({
          unitId: id,
          share: index === 0 ? "4000" : "3000",
        })),
      }),
    );
    const { id: categoryId } = await createChargeCategory(
      manager,
      createChargeCategorySchema.parse({
        residenceId,
        name: "Entretien",
        nameAr: "",
        key: "share",
        weighting: "share",
        buildingId: "",
        unitIds: [],
      }),
    );
    const { budgetId } = await saveBudget(
      manager,
      saveBudgetSchema.parse({
        residenceId,
        year: String(lastYear),
        lines: [{ categoryId, amount: "240 000" }],
        notes: "",
      }),
    );
    await approveBudget(manager, budgetId);
    for (const part of [1, 2]) {
      await issueChargePeriod(
        manager,
        issueChargePeriodSchema.parse({
          period: `${budgetId}:${part}`,
          issuedOn: `${lastYear}-0${part * 3 - 2}-05`,
          dueOn: `${lastYear}-0${part * 3 - 1}-05`,
        }),
      );
    }

    // Rent 40 000 DA + charges 3 000 DA a month since January last year.
    const { id: leaseId } = await createLease(
      manager,
      createLeaseSchema.parse({
        unitId,
        kind: "residential",
        tenantName: "Bouzid Karima",
        tenantPhone: "0661 22 33 44",
        signedOn: `${lastYear - 1}-12-20`,
        startOn: `${lastYear}-01-01`,
        durationMonths: "36",
        monthlyRent: "40 000",
        monthlyCharges: "3 000",
        frequency: "monthly",
        deposit: "",
        notes: "",
      }),
    );
    const before = await getLease(manager, leaseId);
    expect(before?.settlementChoices.find((c) => c.year === lastYear)).toEqual({
      year: lastYear,
      months: 12,
      provisions: 3_600_000n,
      suggested: 4_800_000n,
      settled: false,
    });

    const settle = (overrides: Record<string, string>) =>
      settleLeaseChargesSchema.parse({
        leaseId,
        year: String(lastYear),
        actual: "42 000",
        dueOn: today,
        note: "",
        ...overrides,
      });
    await expect(settleLeaseCharges(cashier, settle({}))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      settleLeaseCharges(manager, settle({ dueOn: addDays(today, -1) })),
    ).rejects.toMatchObject({ messageKey: "rentals.errors.settlementDue" });
    await expect(
      settleLeaseCharges(manager, settle({ year: String(lastYear - 1) })),
    ).rejects.toMatchObject({ messageKey: "rentals.errors.settlementYear" });
    // 42 000 DA spent against 36 000 DA of provisions: 6 000 DA due today.
    expect(await settleLeaseCharges(manager, settle({}))).toMatchObject({ balance: 600_000n });
    await expect(settleLeaseCharges(manager, settle({}))).rejects.toMatchObject({
      messageKey: "rentals.errors.settlementExists",
    });

    const settled = await getLease(manager, leaseId);
    const lines = settled?.statement.lines ?? [];
    const index = lines.findIndex((l) => l.settlementYear === lastYear);
    expect(lines[index]).toMatchObject({ amount: 600_000n, dueOn: today, state: "due" });
    expect(settled?.statement.price).toBe((before?.statement.price ?? 0n) + 600_000n);

    // A payment of everything due up to the settlement prints it on the quittance.
    const amount = lines.slice(0, index + 1).reduce((sum, l) => sum + l.amount, 0n);
    const { paymentId } = await recordRentPayment(
      cashier,
      recordRentPaymentSchema.parse({
        leaseId,
        kind: "rent",
        amount: (amount / 100n).toString(),
        method: "cash",
        paidOn: today,
        payerName: "Bouzid Karima",
      }),
    );
    const [payment] = await withTenant(manager, (tx) =>
      tx
        .select({ allocation: rentPayment.allocation })
        .from(rentPayment)
        .where(eq(rentPayment.id, paymentId)),
    );
    expect(payment?.allocation.at(-1)).toEqual({
      fromOn: `${lastYear}-01-01`,
      toOn: `${lastYear}-12-31`,
      amount: "600000",
      settlementYear: lastYear,
    });

    // This year's charges came under the provisions: 6 000 DA credited to the tenant.
    const { id: creditId, balance } = await settleLeaseCharges(
      manager,
      settle({ year: String(year), actual: "30 000" }),
    );
    expect(balance).toBe(-600_000n);
    const credited = await getLease(manager, leaseId);
    expect(credited?.statement.paid).toBe((settled?.statement.paid ?? 0n) + amount + 600_000n);

    const cancel = cancelChargeSettlementSchema.parse({
      settlementId: creditId,
      reason: "Montant erroné",
    });
    await cancelChargeSettlement(manager, cancel);
    await expect(cancelChargeSettlement(manager, cancel)).rejects.toMatchObject({
      messageKey: "rentals.errors.settlementCancelled",
    });
    const after = await getLease(manager, leaseId);
    expect(after?.statement.paid).toBe((settled?.statement.paid ?? 0n) + amount);
    expect(after?.settlementChoices.find((c) => c.year === year)?.settled).toBe(false);
    expect(after?.settlements.map((s) => [s.year, s.cancellationReason])).toEqual([
      [lastYear, null],
      [year, "Montant erroné"],
    ]);

    const audits = await withTenant(manager, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(
          and(eq(auditLog.entityId, leaseId), like(auditLog.action, "lease.charge_settlement%")),
        ),
    );
    expect(audits.map((a) => a.action).sort()).toEqual([
      "lease.charge_settlement",
      "lease.charge_settlement",
      "lease.charge_settlement_cancel",
    ]);
  });
});
