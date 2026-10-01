import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { auditLog, commissionRate, lead, payment, receipt, unit, unitOption } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { sumCentimes } from "@/lib/money";
import type { TenantCtx } from "@/server/auth/session";
import { listBuyerOptions } from "@/server/buyers/queries";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { getTargetProgress } from "@/server/crm/targets";
import { companySettingsSchema } from "@/server/organizations/schemas";
import { updateCompanySettings } from "@/server/organizations/settings";
import { renderAndStoreReceipt } from "@/server/payments/documents";
import { listSalePayments } from "@/server/payments/queries";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { cancelPayment, clearCheque, recordPayment } from "@/server/payments/service";
import { unitStatusReasonSchema } from "@/server/inventory/schemas";
import { blockUnit } from "@/server/inventory/service";
import { getProjectPaymentSetup } from "@/server/payment-plans/queries";
import { saveMilestonesSchema } from "@/server/payment-plans/schemas";
import { deletePaymentPlan, saveMilestones } from "@/server/payment-plans/service";

import { addMember, companySettingsInput, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { requestSaleDocument } from "./document-requests";
import { renderAndStoreReservationSheet } from "./documents";
import { placeOption } from "./options";
import { listReservableUnits } from "./queries";
import {
  createReservation,
  recordSale,
  setReservationScan,
  updateReservationContract,
} from "./reservations";
import { getSale, getUnitSale, listBuyerSales, listSales } from "./sale-queries";
import {
  createReservationSchema,
  recordSaleSchema,
  reservationContractSchema,
  saleListParams,
} from "./schemas";

type Team = Awaited<ReturnType<typeof createSalesTeam>>;

async function buyerFor(ctx: TenantCtx, leadId: string | null, nin: string) {
  return (
    await createBuyer(
      ctx,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        lastNameAr: "بن سالم",
        firstNameAr: "كريم",
        nin,
        phone: "0550 12 34 56",
        leadId: leadId ?? "",
      }),
    )
  ).id;
}

/** A team, a project, and a commercial's lead with its buyer. */
async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const leadId = await newLead(team.agentA);
  const buyerId = await buyerFor(team.agentA, leadId, "109085198500123456");
  return { team, ...setup, leadId, buyerId };
}

const reserve = (
  ctx: TenantCtx,
  input: { unitId: string; buyerIds: string[]; planId: string; discount?: string; on?: string },
) =>
  createReservation(
    ctx,
    createReservationSchema.parse({
      unitId: input.unitId,
      buyerIds: input.buyerIds,
      paymentPlanId: input.planId,
      discount: input.discount ?? "",
      reservedOn: input.on ?? todayInAlgiers(),
      notary: "Maître Benali",
      reference: "",
      notes: "",
    }),
  );

const pay = (
  ctx: TenantCtx,
  reservationId: string,
  amount: string,
  extra: Record<string, string> = {},
) =>
  recordPayment(
    ctx,
    recordPaymentSchema.parse({
      reservationId,
      amount,
      method: "cash",
      paidOn: todayInAlgiers(),
      payerName: "Karim Bensalem",
      ...extra,
    }),
  );

const pdf = (body = "scan") => new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF`);

const unitStatus = async (ctx: TenantCtx, unitId: string) =>
  (
    await withTenant(ctx, (tx) =>
      tx.select({ s: unit.status }).from(unit).where(eq(unit.id, unitId)),
    )
  )[0]?.s;

describe("reservations", () => {
  it("snapshot the price, build the schedule and move unit and lead on", async () => {
    const { team, unitIds, planId, leadId, buyerId } = await scenario();
    const { id, number, missingDocuments } = await reserve(team.agentA, {
      unitId: unitIds[0],
      buyerIds: [buyerId],
      planId,
    });

    expect(number).toBe(`RES-${todayInAlgiers().slice(0, 4)}-000001`);
    expect(missingDocuments).toBe(6);
    expect(await unitStatus(team.agentA, unitIds[0])).toBe("reserved");
    const sale = await getSale(team.agentA, id);
    expect(sale).toMatchObject({
      status: "reserved",
      price: 1_301_000_000n,
      leadId,
      commercialUserId: team.agentA.userId,
      reservationNotary: "Maître Benali",
    });
    expect(sale?.installments.map((i) => [i.label, i.amount, i.dueOn])).toEqual([
      ["Réservation", 260_200_000n, todayInAlgiers()],
      ["Fondations", 390_300_000n, null],
      ["Gros œuvre", 650_500_000n, null],
    ]);
    expect(sumCentimes(sale?.installments.map((i) => i.amount) ?? [])).toBe(sale?.price);
    expect(sale?.statement).toMatchObject({ due: 260_200_000n, paid: 0n });

    const [leadRow] = await withTenant(team.agentA, (tx) =>
      tx.select({ stage: lead.stage }).from(lead).where(eq(lead.id, leadId)),
    );
    expect(leadRow?.stage).toBe("won");
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pgboss.job where name = 'pdf.document' and data->>'id' = ${id}`,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("let only the option holder's buyer reserve an optioned unit", async () => {
    const { team, unitIds, planId, leadId, buyerId } = await scenario();
    const otherLead = await newLead(team.agentA, "0661 00 00 01");
    const otherBuyer = await buyerFor(team.agentA, otherLead, "109085198500999999");
    const { id: optionId } = await placeOption(team.agentA, { unitId: unitIds[1], leadId });

    await expect(
      reserve(team.agentA, { unitId: unitIds[1], buyerIds: [otherBuyer], planId }),
    ).rejects.toMatchObject({ code: "CONFLICT", messageKey: "sales.errors.optionedForAnother" });
    await reserve(team.agentA, { unitId: unitIds[1], buyerIds: [buyerId, otherBuyer], planId });

    const [option] = await withTenant(team.agentA, (tx) =>
      tx.select({ status: unitOption.status }).from(unitOption).where(eq(unitOption.id, optionId)),
    );
    expect(option?.status).toBe("converted");
    expect(await unitStatus(team.agentA, unitIds[1])).toBe("reserved");
  });

  it("refuse discounts by commercials, future dates, unavailable units and others' buyers", async () => {
    const { team, unitIds, planId, buyerId } = await scenario();
    await blockUnit(
      team.manager,
      unitStatusReasonSchema.parse({ unitId: unitIds[2], reason: "Témoin" }),
    );

    await expect(
      reserve(team.agentA, {
        unitId: unitIds[0],
        buyerIds: [buyerId],
        planId,
        discount: "100 000",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      reserve(team.agentA, { unitId: unitIds[0], buyerIds: [buyerId], planId, on: "2999-01-01" }),
    ).rejects.toMatchObject({ messageKey: "sales.errors.futureDate" });
    await expect(
      reserve(team.agentA, { unitId: unitIds[2], buyerIds: [buyerId], planId }),
    ).rejects.toMatchObject({ messageKey: "sales.errors.unitNotAvailable" });
    await expect(
      reserve(team.agentB, { unitId: unitIds[0], buyerIds: [buyerId], planId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { id } = await reserve(team.manager, {
      unitId: unitIds[0],
      buyerIds: [buyerId],
      planId,
      discount: "10 000",
    });
    expect((await getSale(team.manager, id))?.price).toBe(1_300_000_000n);
  });

  it("keep their milestones: a scheduled milestone cannot be removed from the project", async () => {
    const { team, unitIds, planId, buyerId, projectId, milestoneIds } = await scenario();
    await reserve(team.agentA, { unitId: unitIds[0], buyerIds: [buyerId], planId });
    await deletePaymentPlan(team.manager, { planId });

    const save = (milestones: { id: string; name: string; stage: string }[]) =>
      saveMilestones(
        team.manager,
        saveMilestonesSchema.parse({
          projectId,
          milestones: milestones.map((m) => ({ ...m, plannedOn: "" })),
        }),
      );
    await expect(save([])).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "paymentPlans.errors.milestoneInSale",
    });
    await save([
      { id: milestoneIds[0], name: "Fondations", stage: "foundations" },
      { id: milestoneIds[1], name: "Gros œuvre", stage: "structure" },
    ]);
    const { milestones } = await getProjectPaymentSetup(team.manager, projectId);
    expect(milestones.map((m) => m.stage)).toEqual(["foundations", "structure"]);
  });

  it("are visible to their commercial, managers and cashiers only", async () => {
    const { team, unitIds, planId, buyerId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const { id } = await reserve(team.agentA, { unitId: unitIds[0], buyerIds: [buyerId], planId });
    expect(await getSale(team.agentB, id)).toBeNull();
    expect(await getSale(cashier, id)).not.toBeNull();
    expect(await getSale(team.manager, id)).not.toBeNull();
  });
});

describe("VSP and commissions", () => {
  it("sells the unit and earns the commercial's commission once", async () => {
    const { team, unitIds, planId, buyerId } = await scenario();
    await updateCompanySettings(
      team.owner,
      companySettingsSchema.parse(companySettingsInput({ defaultCommissionRate: "1" })),
    );
    await withTenant(team.owner, (tx) =>
      tx.insert(commissionRate).values({
        organizationId: team.orgId,
        userId: team.agentA.userId,
        rateBp: 150,
      }),
    );
    const { id } = await reserve(team.agentA, { unitId: unitIds[0], buyerIds: [buyerId], planId });
    const input = recordSaleSchema.parse({
      reservationId: id,
      signedOn: todayInAlgiers(),
      notary: "Maître Benali",
      reference: "Acte 2026/415",
    });

    await expect(recordSale(team.agentA, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { saleNumber } = await recordSale(team.manager, input);
    await expect(recordSale(team.manager, input)).rejects.toMatchObject({ code: "CONFLICT" });

    expect(saleNumber).toBe(`VSP-${todayInAlgiers().slice(0, 4)}-000001`);
    expect(await unitStatus(team.manager, unitIds[0])).toBe("sold");
    const sale = await getSale(team.manager, id);
    expect(sale).toMatchObject({ status: "sold", saleNumber, saleNotary: "Maître Benali" });
    expect(sale?.commission).toMatchObject({
      userId: team.agentA.userId,
      rateBp: 150,
      amount: 19_515_000n,
      status: "earned",
    });

    // The month's targets credit the reservation and the VSP to the commercial.
    const [progress] = await getTargetProgress(team.agentA, todayInAlgiers().slice(0, 7));
    expect(progress?.actual).toMatchObject({ reservations: 1, sales: 1 });
  });
});

describe("payments and receipts", () => {
  async function reserved(team: Team, unitId: string, planId: string, buyerId: string) {
    return (await reserve(team.agentA, { unitId, buyerIds: [buyerId], planId })).id;
  }

  it("issue a numbered receipt that snapshots what was settled; excess goes ahead", async () => {
    const { team, unitIds, planId, buyerId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const saleId = await reserved(team, unitIds[0], planId, buyerId);

    const first = await pay(cashier, saleId, "2 000 000");
    const second = await pay(cashier, saleId, "1 000 000");
    expect(first.receiptNumber).toBe(`REC-${todayInAlgiers().slice(0, 4)}-000001`);
    expect(second.receiptNumber).toBe(`REC-${todayInAlgiers().slice(0, 4)}-000002`);

    const receipts = await withTenant(cashier, (tx) =>
      tx.select().from(receipt).where(eq(receipt.paymentId, second.paymentId)),
    );
    expect(receipts[0]?.allocation).toEqual([
      { position: 1, label: "Réservation", amount: "60200000" },
      { position: 2, label: "Fondations", amount: "39800000" },
    ]);
    const sale = await getSale(cashier, saleId);
    expect(sale?.statement).toMatchObject({ paid: 300_000_000n, due: 0n, advance: 39_800_000n });

    await expect(pay(cashier, saleId, "99 999 999")).rejects.toMatchObject({
      messageKey: "payments.errors.aboveBalance",
    });
    await expect(pay(team.agentA, saleId, "1 000")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("are cancelled with a reason by accountants only, never edited or deleted", async () => {
    const { team, unitIds, planId, buyerId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const accountant = await addMember(team.orgId, ["accountant"]);
    const saleId = await reserved(team, unitIds[0], planId, buyerId);
    const cheque = await pay(cashier, saleId, "2 602 000", {
      method: "cheque",
      reference: "4521877",
      bank: "BNA",
    });
    expect(
      recordPaymentSchema.safeParse({
        reservationId: saleId,
        amount: "1000",
        method: "cheque",
        paidOn: todayInAlgiers(),
        payerName: "X",
      }).success,
    ).toBe(false);

    await expect(
      cancelPayment(cashier, { paymentId: cheque.paymentId, reason: "Chèque impayé" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await cancelPayment(accountant, { paymentId: cheque.paymentId, reason: "Chèque impayé" });
    await expect(
      cancelPayment(accountant, { paymentId: cheque.paymentId, reason: "x" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      clearCheque(cashier, { paymentId: cheque.paymentId, clearedOn: todayInAlgiers() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const sale = await getSale(accountant, saleId);
    expect(sale?.statement).toMatchObject({ paid: 0n, due: 260_200_000n });
    const [r] = await withTenant(accountant, (tx) =>
      tx.select().from(receipt).where(eq(receipt.id, cheque.receiptId)),
    );
    expect(r?.status).toBe("cancelled");
    const audit = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action, reason: auditLog.reason })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, cheque.paymentId))),
    );
    expect(audit).toEqual(
      expect.arrayContaining([{ action: "payment.cancel", reason: "Chèque impayé" }]),
    );

    // The database itself refuses edits and deletions.
    await expect(
      withTenant(team.owner, (tx) =>
        tx.update(payment).set({ amount: 1n }).where(eq(payment.id, cheque.paymentId)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(team.owner, (tx) => tx.delete(payment).where(eq(payment.id, cheque.paymentId))),
    ).rejects.toThrow();
  });

  it("record a cheque's clearance once", async () => {
    const { team, unitIds, planId, buyerId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const saleId = await reserved(team, unitIds[0], planId, buyerId);
    const cheque = await pay(cashier, saleId, "500 000", {
      method: "cheque",
      reference: "777",
      bank: "CPA",
    });
    await clearCheque(cashier, { paymentId: cheque.paymentId, clearedOn: todayInAlgiers() });
    await expect(
      clearCheque(cashier, { paymentId: cheque.paymentId, clearedOn: todayInAlgiers() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("render the reservation sheet and the receipt once", async () => {
    const { team, unitIds, planId, buyerId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const saleId = await reserved(team, unitIds[0], planId, buyerId);
    const { receiptId } = await pay(cashier, saleId, "2 602 000");

    expect(await renderAndStoreReservationSheet(team.orgId, saleId)).toBe("stored");
    expect(await renderAndStoreReservationSheet(team.orgId, saleId)).toBe("skipped");
    expect(await renderAndStoreReceipt(team.orgId, receiptId)).toBe("stored");
    expect(await renderAndStoreReceipt(team.orgId, receiptId)).toBe("skipped");
    expect((await getSale(team.agentA, saleId))?.sheetFileName).toMatch(/^RES-\d{4}-\d{6}\.pdf$/);
  });

  it("can be requested again only by members who see the sale", async () => {
    const { team, unitIds, planId, buyerId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const saleId = await reserved(team, unitIds[0], planId, buyerId);
    const { receiptId } = await pay(cashier, saleId, "100 000");
    const jobs = async (id: string) =>
      (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from pgboss.job
              where name = 'pdf.document' and data->>'id' = ${id}`,
        )
      ).rows[0]?.n;

    await expect(
      requestSaleDocument(team.agentB, { kind: "receipt", id: receiptId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      requestSaleDocument(team.agentA, { kind: "payment_call", id: receiptId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await requestSaleDocument(team.agentA, { kind: "receipt", id: receiptId });
    expect(await jobs(receiptId)).toBeGreaterThanOrEqual(1);

    await renderAndStoreReceipt(team.orgId, receiptId);
    const before = await jobs(receiptId);
    await requestSaleDocument(team.agentA, { kind: "receipt", id: receiptId });
    expect(await jobs(receiptId)).toBe(before);
  });
});

describe("contract details and scans", () => {
  it("are kept by managers, audited, and the deed only once the VSP is signed", async () => {
    const { team, unitIds, planId, buyerId } = await scenario();
    const { id } = await reserve(team.agentA, { unitId: unitIds[0], buyerIds: [buyerId], planId });
    const contract = reservationContractSchema.parse({
      reservationId: id,
      notary: "Maître Hamidi",
      reference: "Rép. 2026/88",
    });

    await expect(updateReservationContract(team.agentA, contract)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await updateReservationContract(team.manager, contract);
    expect(await getSale(team.manager, id)).toMatchObject({
      reservationNotary: "Maître Hamidi",
      reservationReference: "Rép. 2026/88",
    });
    const [audit] = await withTenant(team.owner, (tx) =>
      tx
        .select({ before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, id), eq(auditLog.action, "reservation.update_contract"))),
    );
    expect(audit).toEqual({
      before: { notary: "Maître Benali", reference: null },
      after: { notary: "Maître Hamidi", reference: "Rép. 2026/88" },
    });

    const scan = (kind: "contract" | "deed", body: string) =>
      setReservationScan(team.manager, {
        reservationId: id,
        kind,
        upload: { fileName: `${kind}.pdf`, bytes: pdf(body) },
      });
    const first = await scan("contract", "v1");
    const second = await scan("contract", "v2");
    expect(second.fileId).not.toBe(first.fileId);
    expect((await getSale(team.manager, id))?.reservationScanFileId).toBe(second.fileId);
    await expect(scan("deed", "acte")).rejects.toMatchObject({
      messageKey: "sales.errors.notSold",
    });
    await recordSale(
      team.manager,
      recordSaleSchema.parse({
        reservationId: id,
        signedOn: todayInAlgiers(),
        notary: "Maître Hamidi",
        reference: "",
      }),
    );
    const deed = await scan("deed", "acte");
    expect(await getSale(team.manager, id)).toMatchObject({
      saleScanFileId: deed.fileId,
      deedFileName: "deed.pdf",
    });
  });
});

describe("sale lists", () => {
  it("show each member the sales, units and payments they may see", async () => {
    const { team, unitIds, planId, leadId, buyerId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const { id, number } = await reserve(team.agentA, {
      unitId: unitIds[0],
      buyerIds: [buyerId],
      planId,
    });
    await placeOption(team.agentA, { unitId: unitIds[1], leadId });

    const all = await listSales(team.manager, saleListParams.parse({}));
    expect(all.total).toBe(1);
    expect(all.rows[0]).toMatchObject({
      number,
      unitCode: "A-03-01",
      buyers: "Bensalem Karim",
      paid: 0n,
    });
    expect((await listSales(team.agentB, saleListParams.parse({}))).total).toBe(0);
    expect((await listSales(team.manager, saleListParams.parse({ q: "bensal" }))).total).toBe(1);
    expect((await listSales(team.manager, saleListParams.parse({ q: "A-04" }))).total).toBe(0);
    expect(
      (await listSales(team.manager, saleListParams.parse({ status: "sold" }))).total,
    ).toBe(0);

    expect((await listBuyerOptions(team.agentA)).map((b) => b.id)).toEqual([buyerId]);
    expect(await listBuyerOptions(team.agentB)).toEqual([]);
    expect(await listBuyerOptions(team.manager, [])).toEqual([]);

    expect(await listBuyerSales(team.agentA, buyerId)).toEqual([
      expect.objectContaining({ id, number, status: "reserved" }),
    ]);
    expect(await listBuyerSales(team.agentB, buyerId)).toEqual([]);
    expect(await getUnitSale(team.agentA, unitIds[0])).toMatchObject({ id, number });
    expect(await getUnitSale(team.agentA, unitIds[2])).toBeNull();

    // Agent A may reserve the free unit and the one optioned for their lead; agent B only the
    // free unit (the option belongs to a lead they do not see).
    const codes = async (ctx: TenantCtx) =>
      (await listReservableUnits(ctx)).map((u) => [u.code, u.option?.leadId ?? null]);
    expect(await codes(team.agentA)).toEqual([
      ["A-03-02", leadId],
      ["A-04-01", null],
    ]);
    expect(await codes(team.agentB)).toEqual([["A-04-01", null]]);

    const cash = await pay(cashier, id, "1 000 000");
    const cheque = await pay(cashier, id, "500 000", {
      method: "cheque",
      reference: "123",
      bank: "BEA",
    });
    await cancelPayment(team.owner, { paymentId: cheque.paymentId, reason: "Impayé" });
    const payments = await listSalePayments(team.agentA, id);
    expect(payments.map((p) => [p.receiptNumber, p.status])).toEqual(
      expect.arrayContaining([
        [cash.receiptNumber, "valid"],
        [cheque.receiptNumber, "cancelled"],
      ]),
    );
    expect(await listSalePayments(team.agentB, id)).toEqual([]);
    expect((await listSales(cashier, saleListParams.parse({}))).rows[0]?.paid).toBe(100_000_000n);
  });
});
