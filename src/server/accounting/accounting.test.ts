import { afterAll, describe, expect, it } from "vitest";

import { stopEnqueue } from "@/jobs/enqueue";
import { counterpartKey, vatSplit } from "@/lib/accounting";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { approveBudget, saveBudget } from "@/server/charges/budgets";
import { cancelChargePeriod, issueChargePeriod } from "@/server/charges/calls";
import { createChargeCategory } from "@/server/charges/categories";
import {
  cancelChargePeriodSchema,
  createChargeCategorySchema,
  issueChargePeriodSchema,
  saveBudgetSchema,
} from "@/server/charges/schemas";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { createLeaseSchema } from "@/server/rentals/schemas";
import { createLease } from "@/server/rentals/service";
import { createResidenceSchema, saveSharesSchema } from "@/server/residences/schemas";
import { createResidence, saveShares } from "@/server/residences/service";
import { createReservation, recordSale } from "@/server/sales/reservations";
import { createReservationSchema, recordSaleSchema } from "@/server/sales/schemas";
import { createAccountSchema, recordMovementSchema } from "@/server/treasury/schemas";
import { createAccount, recordMovement } from "@/server/treasury/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { accountingCodesSchema } from "./schemas";
import { getAccountingEntries, getAccountingSetup, saveAccountingCodes } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("accounting export", () => {
  it("maps each ledger source to its counterpart", () => {
    expect(counterpartKey("sale", { direction: "in" })).toBe("clients");
    expect(counterpartKey("rent", { direction: "in", deposit: true })).toBe("deposits");
    expect(counterpartKey("works", { direction: "out" })).toBe("contractors");
    expect(counterpartKey("adjustment", { direction: "out" })).toBe("cashShort");
    expect(counterpartKey("expense", { direction: "out" })).toBe("expenses");
  });

  it("writes every flow of every account as two balanced lines", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const accountant = await addMember(team.orgId, ["accountant"]);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const account = (kind: "cash" | "bank", name: string) =>
      createAccount(
        accountant,
        createAccountSchema.parse({
          kind,
          name,
          bankName: kind === "bank" ? "BNA" : "",
          accountNumber: "",
          isDefault: true,
          notes: "",
          openingBalance: "100 000",
          openingOn: addDays(today, -30),
        }),
      );
    const { id: cashId } = await account("cash", "Caisse");
    const { id: bankId } = await account("bank", "BNA");
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({ lastName: "Bensalem", firstName: "Karim", phone: "0550 12 34 56" }),
    );
    const { id: saleId } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: today,
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    const { receiptNumber } = await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount: "50 000",
        method: "cash",
        paidOn: today,
        payerName: "Bensalem Karim",
      }),
    );
    const move = (input: Record<string, string>) =>
      recordMovement(
        accountant,
        recordMovementSchema.parse({ toAccountId: "", category: "", reference: "", ...input }),
      );
    await move({
      kind: "bank_fee",
      accountId: bankId,
      amount: "1 200",
      movedOn: today,
      label: "Frais de tenue de compte",
    });
    await move({
      kind: "transfer",
      accountId: cashId,
      toAccountId: bankId,
      amount: "20 000",
      movedOn: today,
      label: "Versement en banque",
    });

    await expect(getAccountingEntries(cashier, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await saveAccountingCodes(
      accountant,
      accountingCodesSchema.parse({
        codes: { clients: "419100" },
        accounts: [{ accountId: bankId, code: "512100", journal: "BQ1" }],
      }),
    );
    const chart = await getAccountingSetup(accountant);
    expect(chart.codes).toMatchObject({ clients: "419100", bankFees: "627000" });
    expect(chart.accounts.map((a) => [a.name, a.code, a.journal])).toEqual([
      ["Caisse", "530000", "CA"],
      ["BNA", "512100", "BQ1"],
    ]);

    const entries = await getAccountingEntries(accountant, { from: today, to: today });
    expect(entries.debit).toBe(entries.credit);
    const pair = (piece: string | RegExp) =>
      entries.lines
        .filter((l) => (typeof piece === "string" ? l.piece === piece : piece.test(l.label)))
        .map((l) => [l.journal, l.account, l.debit, l.credit]);
    expect(pair(receiptNumber)).toEqual([
      ["CA", "530000", 5_000_000n, 0n],
      ["CA", "419100", 0n, 5_000_000n],
    ]);
    expect(pair(/^Frais de tenue de compte/)).toEqual([
      ["BQ1", "627000", 120_000n, 0n],
      ["BQ1", "512100", 0n, 120_000n],
    ]);
    // A transfer passes through the internal transfers account, once in each journal.
    expect(pair(/^Versement en banque/)).toEqual([
      ["BQ1", "512100", 2_000_000n, 0n],
      ["BQ1", "581000", 0n, 2_000_000n],
      ["CA", "581000", 2_000_000n, 0n],
      ["CA", "530000", 0n, 2_000_000n],
    ]);
  });
});

describe("revenue entries and the G50 worksheet", () => {
  it("splits an amount TTC into HT and VAT", () => {
    expect(vatSplit(11_900n, 1900)).toEqual({ ht: 10_000n, vat: 1_900n });
    expect(vatSplit(100n, 0)).toEqual({ ht: 100n, vat: 0n });
    const { ht, vat } = vatSplit(1_301_000_000n, 1900);
    expect(ht + vat).toBe(1_301_000_000n);
    expect(ht).toBe(1_093_277_311n);
  });

  it("books sales, rents and charge calls at the organization's rates", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const accountant = await addMember(team.orgId, ["accountant"]);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const manager = await addMember(team.orgId, ["property_manager"]);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({ lastName: "Ouali", firstName: "Nadia", phone: "0661 20 30 40" }),
    );
    // A sale signed at the notary today (13 010 000 DA), 50 000 DA received in cash.
    const { id: saleId } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: addDays(today, -5),
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    await recordSale(
      team.manager,
      recordSaleSchema.parse({
        reservationId: saleId,
        signedOn: today,
        notary: "Me Benali",
        reference: "",
      }),
    );
    await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount: "50 000",
        method: "cash",
        paidOn: today,
        payerName: "Ouali Nadia",
      }),
    );
    // A shop leased from today, 119 000 DA a month TTC.
    await createLease(
      manager,
      createLeaseSchema.parse({
        unitId: setup.unitIds[1],
        kind: "commercial",
        tenantName: "SARL Optique El Nour",
        tenantPhone: "0550 44 55 66",
        signedOn: today,
        startOn: today,
        durationMonths: "12",
        monthlyRent: "119 000",
        frequency: "monthly",
        deposit: "",
        notes: "",
      }),
    );
    // A quarter of charges called on the third unit, then cancelled.
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
          share: index === 2 ? "10000" : "0",
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
        year: today.slice(0, 4),
        lines: [{ categoryId, amount: "120 000" }],
        notes: "",
      }),
    );
    await approveBudget(manager, budgetId);
    const { periodId } = await issueChargePeriod(
      manager,
      issueChargePeriodSchema.parse({
        period: `${budgetId}:1`,
        issuedOn: today,
        dueOn: addDays(today, 30),
      }),
    );

    const settings = (revenueEvent: "vsp" | "handover") =>
      accountingCodesSchema.parse({
        codes: {},
        accounts: [],
        tax: {
          revenueEvent,
          vatSales: "19",
          vatRentCommercial: "19",
          vatRentResidential: "",
          stampDuty: "1",
        },
      });
    await saveAccountingCodes(accountant, settings("vsp"));
    expect((await getAccountingSetup(accountant)).tax).toEqual({
      revenueEvent: "vsp",
      vatSalesBp: 1900,
      vatRentCommercialBp: 1900,
      vatRentResidentialBp: 0,
      stampDutyBp: 100,
    });

    const entries = await getAccountingEntries(accountant, { from: today, to: today });
    expect(entries.debit).toBe(entries.credit);
    const journal = (code: string) =>
      entries.lines.filter((l) => l.journal === code).map((l) => [l.account, l.debit, l.credit]);
    const sale = vatSplit(1_301_000_000n, 1900);
    expect(journal("VT")).toEqual(
      expect.arrayContaining([
        ["411000", 1_301_000_000n, 0n],
        ["702000", 0n, sale.ht],
        ["445700", 0n, sale.vat],
        ["411100", 11_900_000n, 0n],
        ["706000", 0n, 10_000_000n],
        ["445700", 0n, 1_900_000n],
      ]),
    );
    // A quarter of 120 000 DA, plus 5 % of reserve fund over the year: 31 500 DA called.
    expect(journal("OD")).toEqual([
      ["467000", 3_150_000n, 0n],
      ["708000", 0n, 3_000_000n],
      ["467100", 0n, 150_000n],
    ]);
    expect(entries.g50).toMatchObject({
      sales: { ttc: 1_301_000_000n, ht: sale.ht, vat: sale.vat },
      rents: { ttc: 11_900_000n, ht: 10_000_000n, vat: 1_900_000n },
      charges: { ttc: 3_150_000n },
      vat: sale.vat + 1_900_000n,
      cash: 5_000_000n,
      stampDuty: 50_000n,
    });

    // The cancelled period is reversed the same day; booked at the handover, the sale waits.
    await cancelChargePeriod(
      accountant,
      cancelChargePeriodSchema.parse({ periodId, reason: "Budget erroné" }),
    );
    await saveAccountingCodes(accountant, settings("handover"));
    const after = await getAccountingEntries(accountant, { from: today, to: today });
    expect(after.debit).toBe(after.credit);
    expect(after.g50.charges.ttc).toBe(0n);
    expect(after.g50.sales.ttc).toBe(0n);
    expect(after.lines.filter((l) => l.journal === "OD")).toHaveLength(6);
  });
});
