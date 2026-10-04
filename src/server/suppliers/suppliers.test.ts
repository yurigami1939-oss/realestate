import { describe, expect, it } from "vitest";

import { and, eq } from "drizzle-orm";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { approveBudget, saveBudget } from "@/server/charges/budgets";
import { issueChargePeriod } from "@/server/charges/calls";
import { createChargeCategory } from "@/server/charges/categories";
import { recordChargePayment } from "@/server/charges/payments";
import { getBudgetReport } from "@/server/charges/report";
import {
  createChargeCategorySchema,
  issueChargePeriodSchema,
  recordChargePaymentSchema,
  saveBudgetSchema,
} from "@/server/charges/schemas";
import { createResidenceSchema, saveSharesSchema } from "@/server/residences/schemas";
import { createResidence, saveShares } from "@/server/residences/service";

import { addMember, createSalesTeam, createTenantCtx } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { deleteInvoice, payInvoice, recordInvoice, updateInvoice } from "./invoices";

import {
  getSupplier,
  listContractTargets,
  listInvoices,
  listResidenceContracts,
  listSuppliers,
} from "./queries";
import {
  createContractSchema,
  createInvoiceSchema,
  createSupplierSchema,
  payInvoiceSchema,
  updateContractSchema,
  updateInvoiceSchema,
  updateSupplierSchema,
} from "./schemas";
import {
  createContract,
  createSupplier,
  deleteContract,
  deleteSupplier,
  updateContract,
  updateSupplier,
} from "./service";

const today = todayInAlgiers();

async function scenario() {
  const team = await createSalesTeam();
  const { projectId, unitIds } = await createSaleSetup(team);
  const manager = await addMember(team.orgId, ["property_manager"]);
  const { id: residenceId } = await createResidence(
    manager,
    createResidenceSchema.parse({
      projectId,
      name: "Résidence Les Oliviers",
      shareBasis: "10000",
      chargeFrequency: "quarterly",
      reserveFund: "5",
      callDueDays: "30",
    }),
  );
  const { id: categoryId } = await createChargeCategory(
    manager,
    createChargeCategorySchema.parse({
      residenceId,
      name: "Ascenseur",
      key: "share",
      weighting: "share",
      buildingId: "",
      unitIds: [],
    }),
  );
  return { team, manager, residenceId, categoryId, unitIds };
}

const supplierInput = (overrides: Record<string, string> = {}) =>
  createSupplierSchema.parse({
    name: "Otis Algérie",
    activity: "Maintenance des ascenseurs",
    phone: "0550 11 22 33",
    email: "contact@otis.test",
    ...overrides,
  });

describe("suppliers", () => {
  it("are kept per organization with their contracts per residence", async () => {
    const { team, manager, residenceId, categoryId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const accountant = await addMember(team.orgId, ["accountant"]);

    await expect(createSupplier(cashier, supplierInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { id: supplierId } = await createSupplier(manager, supplierInput());
    await updateSupplier(
      accountant,
      updateSupplierSchema.parse({
        supplierId,
        name: "Otis Algérie SPA",
        rib: "00799999000123456789",
      }),
    );

    const contract = (overrides: Record<string, string> = {}) =>
      createContractSchema.parse({
        supplierId,
        residenceId,
        categoryId,
        label: "Maintenance trimestrielle",
        startOn: addDays(today, -30),
        endOn: "",
        annualAmount: "240 000",
        ...overrides,
      });
    expect(() => contract({ endOn: addDays(today, -60) })).toThrow();
    // A category of another residence is refused.
    const other = await scenario();
    await expect(
      createContract(manager, contract({ categoryId: other.categoryId })),
    ).rejects.toMatchObject({ messageKey: "charges.errors.categoryNotFound" });

    const { id: running } = await createContract(manager, contract());
    const { id: future } = await createContract(
      manager,
      contract({ label: "Rénovation cabine", categoryId: "", startOn: addDays(today, 10) }),
    );
    expect(
      (await listResidenceContracts(accountant, residenceId)).map((c) => [
        c.label,
        c.categoryName,
        c.running,
        c.annualAmount,
      ]),
    ).toEqual([
      ["Rénovation cabine", null, false, 240_000_00n],
      ["Maintenance trimestrielle", "Ascenseur", true, 240_000_00n],
    ]);
    expect(await listSuppliers(accountant)).toMatchObject([
      { id: supplierId, name: "Otis Algérie SPA", runningContracts: 1 },
    ]);

    await updateContract(
      manager,
      updateContractSchema.parse({
        contractId: running,
        categoryId: "",
        label: "Maintenance",
        startOn: addDays(today, -30),
        endOn: addDays(today, -1),
        annualAmount: "",
      }),
    );
    await deleteContract(manager, future);
    const sheet = await getSupplier(accountant, supplierId);
    expect(sheet?.contracts.map((c) => [c.label, c.running, c.annualAmount])).toEqual([
      ["Maintenance", false, null],
    ]);
    expect((await listContractTargets(manager)).map((r) => r.categories.length)).toEqual([1]);

    // Other organizations never see it.
    expect(await getSupplier(await createTenantCtx(["owner"]), supplierId)).toBeNull();

    await deleteSupplier(manager, supplierId);
    expect(await listSuppliers(manager)).toEqual([]);
    expect(await getSupplier(manager, supplierId)).toBeNull();
  });
});

describe("supplier invoices", () => {
  it("are booked to a category or the reserve fund, paid once and compared with the budget", async () => {
    const { team, manager, residenceId, categoryId, unitIds } = await scenario();
    const accountant = await addMember(team.orgId, ["accountant"]);
    const cashier = await addMember(team.orgId, ["cashier"]);
    await saveShares(
      manager,
      saveSharesSchema.parse({
        residenceId,
        shares: unitIds.map((unitId, index) => ({ unitId, share: index === 0 ? "4000" : "3000" })),
      }),
    );
    // Budget 2026: lift 240 000 DA, reserve fund 5 %; quarter 1 called.
    const { budgetId } = await saveBudget(
      manager,
      saveBudgetSchema.parse({
        residenceId,
        year: "2026",
        lines: [{ categoryId, amount: "240 000" }],
        notes: "",
      }),
    );
    await approveBudget(manager, budgetId);
    await issueChargePeriod(
      manager,
      issueChargePeriodSchema.parse({
        period: `${budgetId}:1`,
        issuedOn: "2026-01-05",
        dueOn: "2026-02-05",
      }),
    );
    // A-03-01 pays its whole call: 24 000 + 1 200 DA of reserve fund.
    await recordChargePayment(
      cashier,
      recordChargePaymentSchema.parse({
        residenceId,
        unitId: unitIds[0],
        amount: "25 200",
        method: "cash",
        paidOn: today,
        payerName: "Saïdi Yasmine",
      }),
    );

    const { id: supplierId } = await createSupplier(manager, supplierInput());
    const { id: otherSupplier } = await createSupplier(manager, supplierInput({ name: "Kone" }));
    const { id: contractId } = await createContract(
      manager,
      createContractSchema.parse({
        supplierId: otherSupplier,
        residenceId,
        categoryId,
        label: "Entretien",
        startOn: "2026-01-01",
      }),
    );

    const invoice = (overrides: Record<string, unknown> = {}) =>
      createInvoiceSchema.parse({
        supplierId,
        residenceId,
        categoryId,
        contractId: "",
        number: "F-2026-014",
        invoiceOn: "2026-02-10",
        dueOn: "2026-03-10",
        label: "Maintenance février",
        amount: "50 000",
        fromReserve: false,
        notes: "",
        ...overrides,
      });
    expect(() => invoice({ categoryId: "" })).toThrow();
    expect(() => invoice({ dueOn: "2026-02-01" })).toThrow();
    await expect(recordInvoice(cashier, invoice())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordInvoice(manager, invoice({ contractId }))).rejects.toMatchObject({
      messageKey: "suppliers.errors.contractMismatch",
    });

    const { id: lift } = await recordInvoice(manager, invoice());
    await expect(recordInvoice(manager, invoice())).rejects.toMatchObject({
      messageKey: "suppliers.errors.invoiceNumberTaken",
    });
    const { id: works } = await recordInvoice(
      accountant,
      invoice({
        number: "F-2026-020",
        categoryId: "",
        fromReserve: true,
        label: "Remplacement des câbles",
        amount: "30 000",
      }),
    );
    const { id: mistake } = await recordInvoice(
      manager,
      invoice({ number: "F-2025-099", invoiceOn: "2025-12-20", dueOn: "", amount: "1 000" }),
    );
    await updateInvoice(
      manager,
      updateInvoiceSchema.parse({
        invoiceId: mistake,
        categoryId,
        contractId: "",
        number: "F-2025-099",
        invoiceOn: "2025-12-20",
        dueOn: "",
        label: "Doublon",
        amount: "1 000",
        fromReserve: false,
        notes: "",
      }),
    );
    await deleteInvoice(manager, mistake);

    // Paid once, then read-only.
    const pay = (invoiceId: string, paidOn: string) =>
      payInvoiceSchema.parse({ invoiceId, paidOn, method: "bank_transfer", reference: "VIR-77" });
    await expect(payInvoice(manager, pay(lift, "2026-02-01"))).rejects.toMatchObject({
      messageKey: "suppliers.errors.paidBeforeInvoice",
    });
    await payInvoice(accountant, pay(lift, "2026-03-01"));
    await expect(payInvoice(accountant, pay(lift, "2026-03-02"))).rejects.toMatchObject({
      messageKey: "suppliers.errors.invoicePaid",
    });
    await expect(deleteInvoice(manager, lift)).rejects.toMatchObject({
      messageKey: "suppliers.errors.invoicePaid",
    });

    const invoices = await listInvoices(accountant, { residenceId, year: 2026 });
    expect(invoices.map((i) => [i.number, i.categoryName, i.fromReserve, i.paidOn])).toEqual([
      ["F-2026-020", null, true, null],
      ["F-2026-014", "Ascenseur", false, "2026-03-01"],
    ]);
    expect(invoices[0]?.overdue).toBe(true);
    expect(await listInvoices(accountant, { supplierId, year: 2025 })).toEqual([]);

    const report = await getBudgetReport(manager, residenceId, 2026);
    expect(report?.lines).toMatchObject([
      {
        name: "Ascenseur",
        budget: 240_000_00n,
        called: 60_000_00n,
        spent: 50_000_00n,
        paid: 50_000_00n,
        variance: 190_000_00n,
      },
    ]);
    expect(report?.reserve).toEqual({
      called: 3_000_00n,
      collected: 1_200_00n,
      spent: 30_000_00n,
      balance: -28_800_00n,
    });
    expect(report?.budgetStatus).toBe("approved");

    const audit = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "supplier_invoice"), eq(auditLog.entityId, lift))),
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      "supplier_invoice.create",
      "supplier_invoice.pay",
    ]);
    expect(works).toBeTruthy();
  });
});
