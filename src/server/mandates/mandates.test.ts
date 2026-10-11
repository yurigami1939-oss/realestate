import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, ownerStatement, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { ownerStatementTotals } from "@/lib/mandates";
import { accountingCodesSchema } from "@/server/accounting/schemas";
import { getAccountingEntries, saveAccountingCodes } from "@/server/accounting/service";
import {
  createBuildingSchema,
  createProjectSchema,
  generateUnitsSchema,
} from "@/server/inventory/schemas";
import { createBuilding, createProject, generateUnits } from "@/server/inventory/service";
import {
  cancelRentPaymentSchema,
  createLeaseSchema,
  endLeaseSchema,
  recordRentPaymentSchema,
} from "@/server/rentals/schemas";
import {
  cancelRentPayment,
  createLease,
  endLease,
  recordRentPayment,
} from "@/server/rentals/service";
import { getRentalTaxes } from "@/server/rentals/taxes";
import { getAccountLedger } from "@/server/treasury/queries";
import { createAccountSchema } from "@/server/treasury/schemas";
import { createAccount } from "@/server/treasury/service";

import { addMember, createTenantCtx } from "../../../tests/factories";

import { renderAndStoreOwnerStatement } from "./documents";
import { getOwner, listMandatableUnits, listOwners } from "./queries";
import {
  cancelOwnerStatementSchema,
  createMandateSchema,
  createOwnerSchema,
  endMandateSchema,
  issueOwnerStatementSchema,
  payOwnerStatementSchema,
} from "./schemas";
import { createMandate, createOwner, endMandate } from "./service";
import { cancelOwnerStatement, issueOwnerStatement, payOwnerStatement } from "./statements";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("management mandates", () => {
  it("nets the rents against the fees and the deductions", () => {
    const line = {
      rentPaymentId: "p",
      leaseNumber: "BAL-1",
      tenantName: "Benali",
      unitCode: "M-01-02",
      receiptNumber: "QIT-1",
      paidOn: "2026-09-01",
      feeRateBp: 800,
    };
    const totals = ownerStatementTotals(
      [
        { ...line, amount: 3_500_000n, reversal: false },
        { ...line, amount: 3_500_000n, reversal: false },
        { ...line, amount: 3_500_000n, reversal: true },
      ],
      [{ label: "Robinet", amount: 150_000n }],
    );
    expect(totals).toMatchObject({
      collected: 3_500_000n,
      fees: 280_000n,
      deductions: 150_000n,
      net: 3_070_000n,
    });
    expect(totals.lines.at(-1)).toMatchObject({ amount: -3_500_000n, fee: -280_000n });
  });

  it("lets an owner's unit, reports its rents, pays them out and books them", async () => {
    const owner = await createTenantCtx();
    const manager = await addMember(owner.orgId, ["property_manager"]);
    const cashier = await addMember(owner.orgId, ["cashier"]);
    const accountant = await addMember(owner.orgId, ["accountant"]);
    await createAccount(
      owner,
      createAccountSchema.parse({
        kind: "bank",
        name: "BNA",
        bankName: "BNA",
        accountNumber: "",
        isDefault: true,
        notes: "",
        openingBalance: "0",
        openingOn: addDays(today, -60),
      }),
    );
    await saveAccountingCodes(
      owner,
      accountingCodesSchema.parse({
        codes: {},
        tax: {
          revenueEvent: "vsp",
          vatSales: "",
          vatRentCommercial: "",
          vatRentResidential: "",
          stampDuty: "",
          vatFees: "19",
          leaseRegistration: "",
          leaseRegistrationDays: "30",
        },
        accounts: [],
      }),
    );
    // A third party's building: its units are delivered, not the organization's.
    const { id: projectId } = await createProject(
      owner,
      createProjectSchema.parse({
        code: "MIMO",
        name: "Immeuble Les Mimosas",
        status: "delivered",
        thirdParty: true,
      }),
    );
    const { id: buildingId } = await createBuilding(
      owner,
      createBuildingSchema.parse({
        projectId,
        code: "M",
        name: "Immeuble",
        lowestFloor: "0",
        topFloor: "1",
      }),
    );
    await generateUnits(
      owner,
      generateUnitsSchema.parse({
        buildingId,
        fromFloor: "1",
        toFloor: "1",
        unitsPerFloor: "2",
        type: "apartment",
        typology: "F3",
        livingArea: "",
      }),
    );
    const [flat] = await withTenant(owner, (tx) =>
      tx.select({ id: unit.id }).from(unit).where(eq(unit.code, "M-01-02")),
    );
    const unitId = flat?.id ?? "";

    const ownerInput = {
      name: "Zerrouki Leila",
      phone: "0698 72 05 14",
      rib: "00200012345678901234",
      bank: "BEA",
    };
    await expect(createOwner(cashier, createOwnerSchema.parse(ownerInput))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { id: ownerId } = await createOwner(manager, createOwnerSchema.parse(ownerInput));
    const mandate = {
      ownerId,
      unitId,
      signedOn: addDays(today, -45),
      startOn: addDays(today, -45),
      feeRate: "8",
      notes: "",
    };
    // A unit the organization still owns is let through an ordinary lease.
    const [own] = await withTenant(owner, (tx) =>
      tx.select({ id: unit.id }).from(unit).where(eq(unit.code, "M-01-01")),
    );
    await withTenant(owner, (tx) =>
      tx
        .update(unit)
        .set({ status: "available" })
        .where(eq(unit.id, own?.id ?? "")),
    );
    await expect(
      createMandate(manager, createMandateSchema.parse({ ...mandate, unitId: own?.id })),
    ).rejects.toMatchObject({ messageKey: "mandates.errors.notOwned" });
    const { id: mandateId } = await createMandate(manager, createMandateSchema.parse(mandate));
    await expect(createMandate(manager, createMandateSchema.parse(mandate))).rejects.toMatchObject({
      messageKey: "mandates.errors.unitTaken",
    });
    expect((await listMandatableUnits(manager)).map((u) => u.id)).not.toContain(unitId);

    // Leased for its owner: the unit stays delivered.
    const { id: leaseId } = await createLease(
      manager,
      createLeaseSchema.parse({
        unitId,
        kind: "residential",
        tenantName: "Benali Karim",
        tenantPhone: "0555 40 12 77",
        signedOn: addDays(today, -40),
        startOn: addDays(today, -40),
        durationMonths: "12",
        monthlyRent: "35 000",
        frequency: "monthly",
        deposit: "",
        notes: "",
      }),
    );
    const [after] = await withTenant(owner, (tx) =>
      tx.select({ status: unit.status }).from(unit).where(eq(unit.id, unitId)),
    );
    expect(after?.status).toBe("delivered");
    await expect(
      endMandate(manager, endMandateSchema.parse({ mandateId, endedOn: today, reason: "Vente" })),
    ).rejects.toMatchObject({ messageKey: "mandates.errors.leased" });

    const pay = (paidOn: string, method: "cash" | "cheque") =>
      recordRentPayment(
        cashier,
        recordRentPaymentSchema.parse({
          leaseId,
          kind: "rent",
          amount: "35 000",
          method,
          paidOn,
          reference: method === "cheque" ? "1234567" : "",
          bank: method === "cheque" ? "CPA" : "",
          payerName: "Benali Karim",
        }),
      );
    const first = await pay(addDays(today, -40), "cheque");
    await pay(addDays(today, -10), "cash");

    // A statement up to 20 days ago reports the first rent only, less 8 % and a repair.
    const statement = await issueOwnerStatement(
      manager,
      issueOwnerStatementSchema.parse({
        ownerId,
        periodTo: addDays(today, -20),
        extras: [{ label: "Remplacement du robinet", amount: "1 500" }],
      }),
    );
    expect(statement.number).toMatch(/^RDG-\d{4}-000001$/);
    let detail = await getOwner(manager, ownerId);
    expect(detail?.statements[0]).toMatchObject({
      collected: 3_500_000n,
      fees: 280_000n,
      deductions: 150_000n,
      net: 3_070_000n,
      status: "issued",
    });
    // The second rent waits for the next statement.
    expect(detail?.pending.collected).toBe(3_500_000n);
    expect((await listOwners(manager))[0]).toMatchObject({ mandates: 1, unpaid: 3_070_000n });

    // Cancelled, its rent is reported again; issued anew and paid out from the bank.
    await cancelOwnerStatement(
      manager,
      cancelOwnerStatementSchema.parse({ statementId: statement.id, reason: "Erreur de date" }),
    );
    const again = await issueOwnerStatement(
      manager,
      issueOwnerStatementSchema.parse({ ownerId, periodTo: today, extras: [] }),
    );
    detail = await getOwner(manager, ownerId);
    expect(detail?.statements[0]).toMatchObject({ collected: 7_000_000n, net: 6_440_000n });
    await expect(
      issueOwnerStatement(
        manager,
        issueOwnerStatementSchema.parse({ ownerId, periodTo: today, extras: [] }),
      ),
    ).rejects.toMatchObject({ messageKey: "mandates.errors.nothingToReport" });
    // Its bilingual PDF, rendered once and filed under the owner.
    expect(await renderAndStoreOwnerStatement(owner.orgId, again.id)).toBe("stored");
    expect(await renderAndStoreOwnerStatement(owner.orgId, again.id)).toBe("skipped");
    await payOwnerStatement(
      manager,
      payOwnerStatementSchema.parse({
        statementId: again.id,
        paidOn: today,
        method: "bank_transfer",
        reference: "VIR-88",
      }),
    );
    await expect(
      cancelOwnerStatement(
        manager,
        cancelOwnerStatementSchema.parse({ statementId: again.id, reason: "Trop tard" }),
      ),
    ).rejects.toMatchObject({ messageKey: "mandates.errors.notIssued" });
    const [bank] = await withTenant(owner, (tx) =>
      tx
        .select({ accountId: ownerStatement.accountId })
        .from(ownerStatement)
        .where(eq(ownerStatement.id, again.id)),
    );
    const ledger = await getAccountLedger(accountant, bank?.accountId ?? "", {
      from: today,
      to: today,
    });
    expect(ledger?.lines.find((l) => l.source === "owner_payout")).toMatchObject({
      amountOut: 6_440_000n,
      reference: "VIR-88",
    });

    // The cheque bounces: the next statement takes the rent back.
    await cancelRentPayment(
      accountant,
      cancelRentPaymentSchema.parse({ paymentId: first.paymentId, reason: "Chèque impayé" }),
    );
    const reversal = await issueOwnerStatement(
      manager,
      issueOwnerStatementSchema.parse({ ownerId, periodTo: today, extras: [] }),
    ).catch((error: unknown) => error);
    // Its net would be negative: nothing is paid back by the owner through a statement.
    expect(reversal).toMatchObject({ messageKey: "mandates.errors.negativeNet" });

    // Accounting: the rents are the owner's, the fees the organization's revenue (19 % VAT).
    const entries = await getAccountingEntries(accountant, {
      from: addDays(today, -60),
      to: today,
    });
    expect(entries.debit).toBe(entries.credit);
    expect(
      entries.lines.filter((l) => l.account === "467200" && l.credit > 0n).length,
    ).toBeGreaterThan(0);
    const fees = entries.lines.filter((l) => l.account === "706200");
    // The cancelled statement's fees and their reversal, then the second one's.
    expect(fees.reduce((sum, l) => sum + l.credit - l.debit, 0n)).toBe(470_588n);
    expect(entries.g50.fees.ttc).toBe(560_000n);
    expect(entries.g50.rents.ttc).toBe(0n);
    expect((await getRentalTaxes(accountant, Number(today.slice(0, 4)))).rows).toEqual([]);

    // The lease ended, the mandate ends; audit on the owner.
    await endLease(manager, endLeaseSchema.parse({ leaseId, endedOn: today, reason: "Départ" }));
    await endMandate(
      manager,
      endMandateSchema.parse({ mandateId, endedOn: today, reason: "Vente" }),
    );
    const [still] = await withTenant(owner, (tx) =>
      tx.select({ status: unit.status }).from(unit).where(eq(unit.id, unitId)),
    );
    expect(still?.status).toBe("delivered");
    const audits = await withTenant(owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "property_owner"), eq(auditLog.entityId, ownerId))),
    );
    expect(audits.map((a) => a.action).sort()).toEqual([
      "management_mandate.create",
      "management_mandate.end",
      "owner_statement.cancel",
      "owner_statement.issue",
      "owner_statement.issue",
      "owner_statement.pay",
      "property_owner.create",
    ]);
  });
});
