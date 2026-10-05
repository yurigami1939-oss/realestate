import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  auditLog,
  chargePayment,
  onlinePayment,
  payment,
  paymentGateway,
  portalLink,
  receipt,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { approveBudget, saveBudget } from "@/server/charges/budgets";
import { issueChargePeriod } from "@/server/charges/calls";
import { createChargeCategory } from "@/server/charges/categories";
import {
  createChargeCategorySchema,
  issueChargePeriodSchema,
  saveBudgetSchema,
} from "@/server/charges/schemas";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import type { PortalCtx } from "@/server/portal/context";
import { getPortalSale } from "@/server/portal/sales";
import { addResidentSchema, createResidenceSchema } from "@/server/residences/schemas";
import { addResident, createResidence } from "@/server/residences/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";
import { decryptSecret } from "@/server/secrets";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { satimStandInUrl } from "./gateway";
import { getGatewaySettings, getPortalOnlinePayment, listOnlinePayments } from "./queries";
import { satimConfirm } from "./satim";
import { decideStandInOrder, handleSatimStandIn } from "./satim-standin";
import {
  gatewaySettingsSchema,
  refundOnlinePaymentSchema,
  startOnlinePaymentSchema,
} from "./schemas";
import {
  checkOnlinePayment,
  finalizeOnlinePayment,
  refundOnlinePayment,
  saveGatewaySettings,
  startOnlinePayment,
} from "./service";

// The gateway is the local SATIM stand-in, called in-process instead of over HTTP.
const realFetch = globalThis.fetch;
beforeAll(() => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const base = satimStandInUrl();
    if (!url.href.startsWith(base)) return realFetch(input, init);
    const path = url.pathname.slice(new URL(base).pathname.length + 1);
    return handleSatimStandIn(new Request(url, init), path, base);
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await stopEnqueue();
});

const gateway = (overrides: Partial<Record<string, unknown>> = {}) =>
  gatewaySettingsSchema.parse({
    enabled: true,
    environment: "test",
    username: `merchant-${randomUUID().slice(0, 6)}`,
    password: "s3cret-SATIM",
    terminalId: "E010900001",
    salesEnabled: true,
    chargesEnabled: true,
    ...overrides,
  });

const pay = (purpose: "sale" | "charges", targetId: string, amount: string) =>
  startOnlinePaymentSchema.parse({ purpose, targetId, amount, acceptTerms: true });

/** A portal account linked to a buyer file or a resident record, as an accepted invitation. */
async function portalAccount(
  staff: TenantCtx,
  target: { buyerId: string } | { residentId: string },
): Promise<PortalCtx> {
  const member = await addMember(staff.orgId, ["resident"]);
  await withTenant(staff, (tx) =>
    tx.insert(portalLink).values({
      organizationId: staff.orgId,
      email: `client-${randomUUID().slice(0, 8)}@example.test`,
      userId: member.userId,
      ...target,
      createdBy: staff.userId,
    }),
  );
  return { userId: member.userId, orgId: staff.orgId, name: "Karim Bensalem", locale: "fr" };
}

/** A reservation signed today (13 010 000 DA, 20 % due now) whose buyer has a portal account. */
async function saleScenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const { id: buyerId } = await createBuyer(
    team.manager,
    createBuyerSchema.parse({
      lastName: "Bensalem",
      firstName: "Karim",
      phone: "0550 12 34 56",
      email: "",
      leadId: "",
    }),
  );
  const { id: saleId } = await createReservation(
    team.manager,
    createReservationSchema.parse({
      unitId: setup.unitIds[0],
      buyerIds: [buyerId],
      paymentPlanId: setup.planId,
      discount: "",
      reservedOn: todayInAlgiers(),
      notary: "",
      reference: "",
      notes: "",
    }),
  );
  const buyer = await portalAccount(team.manager, { buyerId });
  const cashier = await addMember(team.orgId, ["cashier"]);
  const accountant = await addMember(team.orgId, ["accountant"]);
  return { team, setup, saleId, buyer, cashier, accountant };
}

const rowOf = async (orgId: string, id: string) => {
  const [row] = await withTenant({ orgId }, (tx) =>
    tx.select().from(onlinePayment).where(eq(onlinePayment.id, id)),
  );
  if (!row) throw new Error("online payment missing");
  return row;
};

describe("online payment settings", () => {
  it("keeps the merchant password encrypted and never sends it back", async () => {
    const team = await createSalesTeam();
    await expect(saveGatewaySettings(team.manager, gateway())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(saveGatewaySettings(team.owner, gateway({ password: "" }))).rejects.toMatchObject({
      code: "VALIDATION",
    });

    await saveGatewaySettings(team.owner, gateway({ username: "el-bahdja" }));
    const [saved] = await withTenant(team.owner, (tx) =>
      tx.select().from(paymentGateway).where(eq(paymentGateway.organizationId, team.orgId)),
    );
    expect(saved?.passwordEncrypted).not.toContain("s3cret");
    expect(decryptSecret(saved?.passwordEncrypted ?? "")).toBe("s3cret-SATIM");

    // An empty password keeps the saved one; the page never gets it.
    await saveGatewaySettings(team.owner, gateway({ username: "el-bahdja", password: "" }));
    const { settings, testIsStandIn } = await getGatewaySettings(team.owner);
    expect(settings).toMatchObject({ username: "el-bahdja", enabled: true });
    expect(JSON.stringify(settings)).not.toContain("s3cret");
    expect(testIsStandIn).toBe(true);
    const [kept] = await withTenant(team.owner, (tx) =>
      tx.select().from(paymentGateway).where(eq(paymentGateway.organizationId, team.orgId)),
    );
    expect(decryptSecret(kept?.passwordEncrypted ?? "")).toBe("s3cret-SATIM");

    const audits = await withTenant(team.owner, (tx) =>
      tx
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.action, "organization.online_payment")),
    );
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain("s3cret");
  });
});

describe("online payment of a sale", () => {
  it("records the payment and its receipt once the gateway confirms it", async () => {
    const { team, saleId, buyer } = await saleScenario();
    await saveGatewaySettings(team.owner, gateway());

    const started = await startOnlinePayment(buyer, pay("sale", saleId, "100 000"));
    expect(started.formUrl).toMatch(/\/api\/dev\/satim\/payment\?mdOrder=/);
    const pending = await rowOf(team.orgId, started.id);
    expect(pending).toMatchObject({ status: "pending", amount: 100_000_00n, environment: "test" });
    expect(pending.orderNumber).toMatch(/^\d{10}$/);

    // The payer comes back without paying: nothing is decided yet.
    expect((await finalizeOnlinePayment(team.orgId, started.id))?.status).toBe("pending");

    decideStandInOrder(pending.gatewayOrderId ?? "", "pay");
    const paid = await finalizeOnlinePayment(team.orgId, started.id);
    expect(paid).toMatchObject({ status: "paid", issue: null, cardPan: "628058**1011" });
    expect(paid?.approvalCode).toMatch(/^\d{6}$/);
    expect(paid?.gatewayMessage).toBe("Votre paiement a été accepté");

    const [recorded] = await withTenant(team.owner, (tx) =>
      tx
        .select({ payment, receiptNumber: receipt.number })
        .from(payment)
        .innerJoin(receipt, eq(receipt.paymentId, payment.id))
        .where(eq(payment.reservationId, saleId)),
    );
    expect(recorded?.payment).toMatchObject({
      id: paid?.paymentId,
      amount: 100_000_00n,
      method: "card",
      reference: pending.orderNumber,
      recordedBy: buyer.userId,
      payerName: "Karim Bensalem",
    });
    expect(recorded?.receiptNumber).toMatch(/^REC-\d{4}-\d{6}$/);

    // Idempotent: the return and the background check may both run.
    await finalizeOnlinePayment(team.orgId, started.id);
    expect(await checkOnlinePayment(team.orgId, started.id)).toBe("settled");
    const payments = await withTenant(team.owner, (tx) =>
      tx.select().from(payment).where(eq(payment.reservationId, saleId)),
    );
    expect(payments).toHaveLength(1);
    const sale = await getPortalSale(buyer, saleId);
    expect(sale?.statement.paid).toBe(100_000_00n);

    const view = await getPortalOnlinePayment(buyer, started.id);
    expect(view).toMatchObject({ status: "paid", receiptNumber: recorded?.receiptNumber });

    const audits = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(sql`${auditLog.action} in ('online_payment.paid', 'payment.create')`),
    );
    expect(audits.map((a) => a.action).sort()).toEqual(["online_payment.paid", "payment.create"]);
    expect(audits.find((a) => a.action === "payment.create")?.after).toMatchObject({
      method: "card",
      onlineOrder: pending.orderNumber,
    });
  });

  it("refuses what the account may not pay", async () => {
    const { team, saleId, buyer } = await saleScenario();
    await expect(startOnlinePayment(buyer, pay("sale", saleId, "1 000"))).rejects.toMatchObject({
      messageKey: "onlinePayments.errors.disabled",
    });
    await saveGatewaySettings(team.owner, gateway({ salesEnabled: false }));
    await expect(startOnlinePayment(buyer, pay("sale", saleId, "1 000"))).rejects.toMatchObject({
      messageKey: "onlinePayments.errors.disabled",
    });
    await saveGatewaySettings(team.owner, gateway());

    await expect(
      startOnlinePayment(buyer, pay("sale", saleId, "13 010 000,01")),
    ).rejects.toMatchObject({ messageKey: "onlinePayments.errors.aboveBalance" });
    expect(() => pay("sale", saleId, "49,99")).toThrow();
    expect(() =>
      startOnlinePaymentSchema.parse({
        purpose: "sale",
        targetId: saleId,
        amount: "1 000",
        acceptTerms: false,
      }),
    ).toThrow();

    // Someone else's sale, or a unit the account does not co-own.
    const other = await saleScenario();
    await expect(
      startOnlinePayment(buyer, pay("sale", other.saleId, "1 000")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      startOnlinePayment(buyer, pay("charges", randomUUID(), "1 000")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("leaves a declined card unrecorded and expires an abandoned payment, unless paid late", async () => {
    const { team, saleId, buyer } = await saleScenario();
    await saveGatewaySettings(team.owner, gateway());

    const declined = await startOnlinePayment(buyer, pay("sale", saleId, "50 000"));
    decideStandInOrder((await rowOf(team.orgId, declined.id)).gatewayOrderId ?? "", "decline");
    expect(await finalizeOnlinePayment(team.orgId, declined.id)).toMatchObject({
      status: "failed",
      paymentId: null,
      gatewayMessage: "Votre transaction a été rejetée",
    });

    const abandoned = await startOnlinePayment(buyer, pay("sale", saleId, "50 000"));
    // Within the gateway session, an open order stays pending.
    expect(await checkOnlinePayment(team.orgId, abandoned.id)).toBe("open");
    await withTenant(team.owner, (tx) =>
      tx
        .update(onlinePayment)
        .set({ createdAt: new Date(Date.now() - 25 * 60_000) })
        .where(eq(onlinePayment.id, abandoned.id)),
    );
    expect(await checkOnlinePayment(team.orgId, abandoned.id)).toBe("settled");
    expect((await rowOf(team.orgId, abandoned.id)).status).toBe("expired");

    // Money taken is always recorded, even after the payment was given up.
    decideStandInOrder((await rowOf(team.orgId, abandoned.id)).gatewayOrderId ?? "", "pay");
    expect((await finalizeOnlinePayment(team.orgId, abandoned.id))?.status).toBe("paid");
    const payments = await withTenant(team.owner, (tx) =>
      tx.select().from(payment).where(eq(payment.reservationId, saleId)),
    );
    expect(payments.map((p) => p.amount)).toEqual([50_000_00n]);
  });

  it("keeps a payment it cannot record as an issue, refunded by an accountant", async () => {
    const { team, saleId, buyer, cashier, accountant } = await saleScenario();
    await saveGatewaySettings(team.owner, gateway());
    const started = await startOnlinePayment(buyer, pay("sale", saleId, "100 000"));

    // Meanwhile the cashier takes the whole balance at the counter.
    await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount: "13 010 000",
        method: "bank_transfer",
        paidOn: todayInAlgiers(),
        reference: "VIR-1",
        payerName: "Bensalem Karim",
      }),
    );
    const orderId = (await rowOf(team.orgId, started.id)).gatewayOrderId ?? "";
    decideStandInOrder(orderId, "pay");
    expect(await finalizeOnlinePayment(team.orgId, started.id)).toMatchObject({
      status: "paid",
      paymentId: null,
      issue: "payments.errors.aboveBalance",
    });

    const listed = await listOnlinePayments(cashier, { issues: "1", q: null });
    expect(listed.rows.map((r) => r.id)).toEqual([started.id]);
    expect(listed.issues).toBe(1);

    const refund = refundOnlinePaymentSchema.parse({
      onlinePaymentId: started.id,
      reason: "Solde déjà réglé par virement",
    });
    await expect(refundOnlinePayment(cashier, refund)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await refundOnlinePayment(accountant, refund);
    expect(await rowOf(team.orgId, started.id)).toMatchObject({
      status: "refunded",
      refundedBy: accountant.userId,
      refundReason: "Solde déjà réglé par virement",
    });
    // The gateway refunded the order.
    const account = {
      baseUrl: satimStandInUrl(),
      username: await usernameOf(team.orgId),
      password: "-",
      terminalId: "-",
    };
    const state = await satimConfirm(account, orderId, "fr");
    expect(state.orderStatus).toBe(4);
    await expect(refundOnlinePayment(accountant, refund)).rejects.toMatchObject({
      messageKey: "onlinePayments.errors.notPaid",
    });
  });

  it("refunds a recorded payment: the payment and its receipt are cancelled", async () => {
    const { team, saleId, buyer, accountant } = await saleScenario();
    await saveGatewaySettings(team.owner, gateway());
    const started = await startOnlinePayment(buyer, pay("sale", saleId, "75 000"));
    decideStandInOrder((await rowOf(team.orgId, started.id)).gatewayOrderId ?? "", "pay");
    const paid = await finalizeOnlinePayment(team.orgId, started.id);
    await refundOnlinePayment(
      accountant,
      refundOnlinePaymentSchema.parse({
        onlinePaymentId: started.id,
        reason: "Paiement en double",
      }),
    );
    const [cancelled] = await withTenant(team.owner, (tx) =>
      tx
        .select({ status: payment.status, receipt: receipt.status })
        .from(payment)
        .innerJoin(receipt, eq(receipt.paymentId, payment.id))
        .where(eq(payment.id, paid?.paymentId ?? "")),
    );
    expect(cancelled).toEqual({ status: "cancelled", receipt: "cancelled" });
    expect((await getPortalSale(buyer, saleId))?.statement.paid).toBe(0n);
  });
});

/** The gateway username saved for the organization (the stand-in checks it). */
async function usernameOf(orgId: string) {
  const [row] = await withTenant({ orgId }, (tx) =>
    tx.select({ username: paymentGateway.username }).from(paymentGateway),
  );
  return row?.username ?? "";
}

describe("online payment of charges", () => {
  it("records a co-owner's payment as a charge payment with its receipt", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const [coUnit, otherUnit] = setup.unitIds;
    const manager = await addMember(team.orgId, ["property_manager"]);
    const { id: residenceId } = await createResidence(
      manager,
      createResidenceSchema.parse({
        projectId: setup.projectId,
        name: "Résidence Les Oliviers",
        shareBasis: "10000",
        chargeFrequency: "quarterly",
        reserveFund: "0",
        callDueDays: "30",
      }),
    );
    const { id: categoryId } = await createChargeCategory(
      manager,
      createChargeCategorySchema.parse({
        residenceId,
        name: "Nettoyage",
        nameAr: "",
        key: "equal",
        weighting: "equal",
        buildingId: "",
        unitIds: [],
      }),
    );
    const { budgetId } = await saveBudget(
      manager,
      saveBudgetSchema.parse({
        residenceId,
        year: todayInAlgiers().slice(0, 4),
        lines: [{ categoryId, amount: "120 000" }],
        notes: "",
      }),
    );
    await approveBudget(manager, budgetId);
    const { id: coOwnerId } = await addResident(
      manager,
      addResidentSchema.parse({
        residenceId,
        unitId: coUnit,
        kind: "co_owner",
        isMain: true,
        lastName: "Saïdi",
        firstName: "Yasmine",
        email: "",
        sinceOn: "2026-01-01",
      }),
    );
    await issueChargePeriod(
      manager,
      issueChargePeriodSchema.parse({
        period: `${budgetId}:1`,
        issuedOn: addDays(todayInAlgiers(), -5),
        dueOn: addDays(todayInAlgiers(), 25),
      }),
    );
    const coOwner = await portalAccount(manager, { residentId: coOwnerId });
    await saveGatewaySettings(team.owner, gateway());

    await expect(
      startOnlinePayment(coOwner, pay("charges", otherUnit ?? "", "1 000")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      startOnlinePayment(coOwner, pay("charges", coUnit ?? "", "10 000,01")),
    ).rejects.toMatchObject({ messageKey: "onlinePayments.errors.aboveBalance" });

    const started = await startOnlinePayment(coOwner, pay("charges", coUnit ?? "", "10 000"));
    decideStandInOrder((await rowOf(team.orgId, started.id)).gatewayOrderId ?? "", "pay");
    const paid = await finalizeOnlinePayment(team.orgId, started.id);
    expect(paid).toMatchObject({ status: "paid", paymentId: null, issue: null });
    const [recorded] = await withTenant(manager, (tx) =>
      tx
        .select()
        .from(chargePayment)
        .where(
          and(eq(chargePayment.residenceId, residenceId), eq(chargePayment.unitId, coUnit ?? "")),
        ),
    );
    expect(recorded).toMatchObject({
      id: paid?.chargePaymentId,
      amount: 10_000_00n,
      method: "card",
      recordedBy: coOwner.userId,
    });
    expect(recorded?.receiptNumber).toMatch(/^RCH-\d{4}-\d{6}$/);

    // The gestionnaire sees charges payments, not sales ones; commercials see none.
    const listed = await listOnlinePayments(manager, { q: null });
    expect(listed.rows.map((r) => r.id)).toEqual([started.id]);
    expect(listed.rows[0]).toMatchObject({
      residenceName: "Résidence Les Oliviers",
      chargeReceiptNumber: recorded?.receiptNumber,
    });
    await expect(listOnlinePayments(team.agentA, { q: null })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
