import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";
import { getAccountLedger } from "@/server/treasury/queries";
import { createAccountSchema } from "@/server/treasury/schemas";
import { createAccount } from "@/server/treasury/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getProjectCosts, getWorksContract } from "./queries";
import {
  acceptContractSchema,
  createContractorSchema,
  createContractSchema,
  createWorksInvoiceSchema,
  payWorksInvoiceSchema,
  releaseRetentionSchema,
  saveBudgetLinesSchema,
  updateContractSchema,
} from "./schemas";
import {
  acceptContract,
  createContract,
  createContractor,
  deleteWorksInvoice,
  payWorksInvoice,
  recordWorksInvoice,
  releaseRetention,
  saveBudgetLines,
  updateContract,
} from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const technical = await addMember(team.orgId, ["technical_manager"]);
  const accountant = await addMember(team.orgId, ["accountant"]);
  const { id: bankId } = await createAccount(
    accountant,
    createAccountSchema.parse({
      kind: "bank",
      name: "BNA",
      bankName: "BNA",
      accountNumber: "",
      isDefault: true,
      notes: "",
      openingBalance: "50 000 000",
      openingOn: addDays(today, -400),
    }),
  );
  const { id: contractorId } = await createContractor(
    technical,
    createContractorSchema.parse({ name: "ETB Bensaïd & Fils", activity: "Gros œuvre" }),
  );
  return { team, setup, technical, accountant, bankId, contractorId };
}

const contractInput = (
  projectId: string,
  supplierId: string,
  overrides: Record<string, string> = {},
) =>
  createContractSchema.parse({
    projectId,
    supplierId,
    category: "works",
    reference: "M-2025/04",
    title: "Gros œuvre Bloc A",
    amount: "10 000 000",
    retention: "5",
    signedOn: addDays(today, -300),
    plannedEndOn: addDays(today, 90),
    notes: "",
    ...overrides,
  });

describe("construction costs", () => {
  it("tracks a contract's progress invoices, retention, acceptance and payments", async () => {
    const { team, setup, technical, accountant, bankId, contractorId } = await scenario();
    await expect(
      createContract(team.agentA, contractInput(setup.projectId, contractorId)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { id: contractId } = await createContract(
      technical,
      contractInput(setup.projectId, contractorId),
    );
    const invoice = (gross: string, daysAgo: number) =>
      recordWorksInvoice(
        technical,
        createWorksInvoiceSchema.parse({
          contractId,
          number: `F-${daysAgo}`,
          invoicedOn: addDays(today, -daysAgo),
          dueOn: "",
          label: "",
          gross,
        }),
      );
    const first = await invoice("4 000 000", 60);
    expect(first).toMatchObject({ retention: 20_000_000n, net: 380_000_000n });
    await invoice("3 000 000", 30);
    await expect(invoice("3 000 001", 1)).rejects.toMatchObject({
      messageKey: "costs.errors.aboveContract",
    });
    const third = await invoice("1 000 000", 1);
    // Only the last unpaid one may be deleted; the retention rate is fixed now.
    await deleteWorksInvoice(technical, { invoiceId: third.id });
    await expect(
      updateContract(
        technical,
        updateContractSchema.parse({
          contractId,
          supplierId: contractorId,
          category: "works",
          reference: "",
          title: "Gros œuvre Bloc A",
          amount: "10 000 000",
          retention: "7",
          signedOn: addDays(today, -300),
          plannedEndOn: "",
          notes: "",
        }),
      ),
    ).rejects.toMatchObject({ messageKey: "costs.errors.retentionFixed" });

    // The technical manager does not pay; the accountant pays from the bank.
    const pay = (ctx: typeof accountant) =>
      payWorksInvoice(
        ctx,
        payWorksInvoiceSchema.parse({
          invoiceId: first.id,
          paidOn: addDays(today, -50),
          method: "bank_transfer",
          reference: "VIR-881",
        }),
      );
    await expect(pay(technical)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await pay(accountant);
    await expect(pay(accountant)).rejects.toMatchObject({
      messageKey: "costs.errors.invoicePaid",
    });
    const ledger = await getAccountLedger(accountant, bankId, {
      from: addDays(today, -60),
      to: today,
    });
    expect(ledger?.lines.map((l) => [l.source, l.amountOut])).toEqual([["works", 380_000_000n]]);

    // Réceptions, then the retention released once.
    const accept = (stage: "provisional" | "final", daysAgo: number) =>
      acceptContract(
        technical,
        acceptContractSchema.parse({
          contractId,
          stage,
          acceptedOn: addDays(today, -daysAgo),
          notes: stage === "provisional" ? "Réserves : joints de façade" : "",
        }),
      );
    const release = () =>
      releaseRetention(
        accountant,
        releaseRetentionSchema.parse({
          contractId,
          paidOn: today,
          method: "bank_transfer",
          reference: "",
        }),
      );
    await expect(accept("final", 5)).rejects.toMatchObject({
      messageKey: "costs.errors.provisionalFirst",
    });
    await accept("provisional", 10);
    await expect(release()).rejects.toMatchObject({ messageKey: "costs.errors.notFinal" });
    await accept("final", 2);
    await release();
    await expect(release()).rejects.toMatchObject({ messageKey: "costs.errors.released" });

    const contract = await getWorksContract(accountant, contractId);
    expect(contract).toMatchObject({
      state: "final",
      invoiced: 700_000_000n,
      retention: 35_000_000n,
      retentionHeld: 0n,
      paid: 380_000_000n + 35_000_000n,
      unpaid: 285_000_000n,
    });
    const actions = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "works_contract"), eq(auditLog.entityId, contractId))),
    );
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "works_contract.create",
        "works_invoice.create",
        "works_invoice.delete",
        "works_invoice.pay",
        "works_contract.accept_provisional",
        "works_contract.accept_final",
        "works_contract.release_retention",
      ]),
    );
  });

  it("weighs the budget, the commitments and the sales into a margin and a forecast", async () => {
    const { team, setup, technical, contractorId } = await scenario();
    await saveBudgetLines(
      technical,
      saveBudgetLinesSchema.parse({
        projectId: setup.projectId,
        lines: [
          { category: "land", label: "Terrain", amount: "5 000 000" },
          { category: "works", label: "Gros œuvre et CES", amount: "20 000 000" },
        ],
      }),
    );
    await createContract(
      technical,
      contractInput(setup.projectId, contractorId, { amount: "22 000 000" }),
    );
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        leadId: "",
      }),
    );
    await createReservation(
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
    await expect(getProjectCosts(team.manager, setup.projectId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const costs = await getProjectCosts(technical, setup.projectId);
    expect(costs?.byCategory.find((c) => c.category === "works")).toMatchObject({
      budget: 2_000_000_000n,
      committed: 2_200_000_000n,
    });
    // Revenue: the sale signed (13 010 000) and the two units left at their list price.
    expect(costs?.revenue).toMatchObject({
      signed: 1_301_000_000n,
      revenue: 3_903_000_000n,
      cost: 2_700_000_000n,
      margin: 1_203_000_000n,
    });
    // The signing installment (20 %) falls due this month; the contract is spread to its end.
    const month = costs?.forecast[0];
    expect(month?.expectedIn).toBe(260_200_000n);
    expect(costs?.forecast.reduce((sum, m) => sum + m.expectedOut, 0n)).toBe(2_200_000_000n);
    expect(costs?.undatedIn).toBe(1_040_800_000n);
  });
});
