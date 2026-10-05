import { createHmac } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { auditLog, buyer, whatsappAccount, whatsappMessage } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { whatsappKinds } from "@/lib/whatsapp";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { createAnnouncementSchema } from "@/server/announcements/schemas";
import { createAnnouncement, publishAnnouncement } from "@/server/announcements/service";
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
import { addResidentSchema, createResidenceSchema } from "@/server/residences/schemas";
import { addResident, createResidence } from "@/server/residences/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";
import { decryptSecret } from "@/server/secrets";
import { standInUrl } from "@/server/stand-ins";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getWhatsappSettings, listWhatsappMessages } from "./queries";
import { whatsappSettingsSchema } from "./schemas";
import {
  receiveWhatsappWebhook,
  saveWhatsappSettings,
  sendWhatsappMessage,
  setResidentWhatsapp,
  verifyWhatsappWebhook,
} from "./service";
import { handleWhatsappStandIn, standInMessages } from "./standin";

// The Cloud API is the local stand-in, called in-process; `metaDown` makes it fail like Meta.
const realFetch = globalThis.fetch;
let metaDown = false;
beforeAll(() => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const base = standInUrl("whatsapp");
    if (!url.href.startsWith(base)) return realFetch(input, init);
    if (metaDown) return Promise.resolve(new Response("Service Unavailable", { status: 503 }));
    return handleWhatsappStandIn(
      new Request(url, init),
      url.pathname.slice(new URL(base).pathname.length + 1),
    );
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await stopEnqueue();
});

const APP_SECRET = "app-secret-for-tests";

const settings = (overrides: Record<string, unknown> = {}) =>
  whatsappSettingsSchema.parse({
    enabled: true,
    phoneNumberId: "100200300400500",
    businessAccountId: "",
    accessToken: "token-xyz",
    appSecret: APP_SECRET,
    language: "fr",
    notifications: whatsappKinds.map((kind) => ({ kind, enabled: true, template: "" })),
    ...overrides,
  });

const newBuyer = (ctx: TenantCtx, phone: string, whatsappOptIn: boolean, name = "Karim") =>
  createBuyer(
    ctx,
    createBuyerSchema.parse({
      lastName: "Bensalem",
      firstName: name,
      phone,
      whatsappOptIn,
      email: "",
      leadId: "",
    }),
  );

/** A reservation (buyers given) and a cashier; WhatsApp set up with every notification on. */
async function scenario(
  buyerIds: (team: Awaited<ReturnType<typeof createSalesTeam>>) => Promise<string[]>,
) {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const ids = await buyerIds(team);
  const { id: saleId } = await createReservation(
    team.manager,
    createReservationSchema.parse({
      unitId: setup.unitIds[0],
      buyerIds: ids,
      paymentPlanId: setup.planId,
      discount: "",
      reservedOn: todayInAlgiers(),
      notary: "",
      reference: "",
      notes: "",
    }),
  );
  const cashier = await addMember(team.orgId, ["cashier"]);
  return { team, setup, saleId, cashier };
}

const pay = (cashier: TenantCtx, saleId: string, amount = "10 000") =>
  recordPayment(
    cashier,
    recordPaymentSchema.parse({
      reservationId: saleId,
      amount,
      method: "cash",
      paidOn: todayInAlgiers(),
      payerName: "Bensalem Karim",
    }),
  );

const messagesOf = (orgId: string) =>
  withTenant({ orgId }, (tx) =>
    tx.select().from(whatsappMessage).orderBy(whatsappMessage.createdAt),
  );

const signed = (body: unknown) => {
  const raw = JSON.stringify(body);
  return { raw, signature: `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}` };
};

describe("WhatsApp settings", () => {
  it("keeps the token and app secret encrypted, never sent back, and draws the verify token once", async () => {
    const team = await createSalesTeam();
    await expect(saveWhatsappSettings(team.manager, settings())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      saveWhatsappSettings(team.owner, settings({ accessToken: "" })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(() => settings({ phoneNumberId: "abc" })).toThrow();

    await saveWhatsappSettings(team.owner, settings());
    const first = await getWhatsappSettings(team.owner);
    expect(first.settings).toMatchObject({ enabled: true, hasAppSecret: true, language: "fr" });
    expect(JSON.stringify(first)).not.toContain("token-xyz");
    expect(first.webhookUrl).toMatch(new RegExp(`/api/webhooks/whatsapp/${team.orgId}$`));

    // Empty secrets keep the saved ones; the verify token stays.
    await saveWhatsappSettings(
      team.owner,
      settings({ accessToken: "", appSecret: "", language: "ar" }),
    );
    const [row] = await withTenant(team.owner, (tx) =>
      tx.select().from(whatsappAccount).where(eq(whatsappAccount.organizationId, team.orgId)),
    );
    expect(decryptSecret(row?.accessTokenEncrypted ?? "")).toBe("token-xyz");
    expect(decryptSecret(row?.appSecretEncrypted ?? "")).toBe(APP_SECRET);
    expect(row?.verifyToken).toBe(first.settings?.verifyToken);
    expect(row?.language).toBe("ar");
    const audits = await withTenant(team.owner, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, "organization.whatsapp")),
    );
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain("token-xyz");
  });
});

describe("WhatsApp messages", () => {
  it("queues a receipt message for each buyer who agreed, sends it, and logs Meta's answer", async () => {
    const { team, saleId, cashier } = await scenario(async (t) => [
      (await newBuyer(t.manager, "0661 50 12 34", true)).id,
      (await newBuyer(t.manager, "0550 99 88 77", false, "Amina")).id,
    ]);
    // Nothing before WhatsApp is set up.
    await pay(cashier, saleId);
    expect(await messagesOf(team.orgId)).toHaveLength(0);

    await saveWhatsappSettings(team.owner, settings());
    const { receiptNumber } = await pay(cashier, saleId, "12 500");
    const [queued, ...others] = await messagesOf(team.orgId);
    expect(others).toHaveLength(0);
    expect(queued).toMatchObject({
      kind: "payment_received",
      recipient: "213661501234",
      recipientName: "Karim Bensalem",
      template: "paiement_recu",
      language: "fr",
      status: "queued",
      refType: "reservation",
      refId: saleId,
    });
    expect(queued?.params).toEqual([
      "Karim Bensalem",
      expect.stringMatching(/^Promotion /),
      "12 500,00 DA",
      "le lot A-03-01 (Résidence Les Oliviers)",
      receiptNumber,
    ]);

    expect(await sendWhatsappMessage(team.orgId, queued?.id ?? "", 0)).toBe("sent");
    const [sent] = await messagesOf(team.orgId);
    expect(sent?.status).toBe("sent");
    expect(sent?.wamid).toMatch(/^wamid\.STANDIN/);
    expect(standInMessages()[0]).toMatchObject({
      to: "213661501234",
      template: "paiement_recu",
      language: "fr",
      phoneNumberId: "100200300400500",
    });
    // Sent once only.
    expect(await sendWhatsappMessage(team.orgId, queued?.id ?? "", 0)).toBe("skipped");

    const log = await listWhatsappMessages(cashier, {});
    expect(log.rows.map((r) => r.id)).toEqual([queued?.id]);
    await expect(listWhatsappMessages(team.agentA, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("skips landlines and switched-off notifications, retries while Meta is down, then fails", async () => {
    const { team, saleId, cashier } = await scenario(async (t) => [
      (await newBuyer(t.manager, "021 63 45 78", true)).id,
    ]);
    await saveWhatsappSettings(team.owner, settings());
    await pay(cashier, saleId);
    expect(await messagesOf(team.orgId)).toHaveLength(0);

    const mobile = await newBuyer(team.manager, "0770 11 00 00", true, "Nora");
    await withTenant(team.owner, (tx) =>
      tx.update(buyer).set({ phone: "+213770110000" }).where(eq(buyer.id, mobile.id)),
    );
    const other = await scenario(async (t) => [
      (await newBuyer(t.manager, "0770 12 34 56", true)).id,
    ]);
    await saveWhatsappSettings(
      other.team.owner,
      settings({
        notifications: whatsappKinds.map((kind) => ({
          kind,
          enabled: kind !== "payment_received",
          template: "",
        })),
      }),
    );
    await pay(other.cashier, other.saleId);
    expect(await messagesOf(other.team.orgId)).toHaveLength(0);

    // Meta unreachable: retried (thrown) until the last attempt, then failed.
    await saveWhatsappSettings(
      other.team.owner,
      settings({
        notifications: whatsappKinds.map((kind) => ({ kind, enabled: true, template: "recu_v2" })),
      }),
    );
    await pay(other.cashier, other.saleId);
    const [message] = await messagesOf(other.team.orgId);
    expect(message?.template).toBe("recu_v2");
    metaDown = true;
    try {
      await expect(sendWhatsappMessage(other.team.orgId, message?.id ?? "", 0)).rejects.toThrow();
      expect(await sendWhatsappMessage(other.team.orgId, message?.id ?? "", 5)).toBe("failed");
    } finally {
      metaDown = false;
    }
    const [failed] = await messagesOf(other.team.orgId);
    expect(failed).toMatchObject({ status: "failed", error: "HTTP 503" });
  });

  it("records an undeliverable number as failed with Meta's error", async () => {
    const { team, saleId, cashier } = await scenario(async (t) => [
      (await newBuyer(t.manager, "0770 12 00 00", true)).id,
    ]);
    await saveWhatsappSettings(team.owner, settings());
    await pay(cashier, saleId);
    const [message] = await messagesOf(team.orgId);
    expect(await sendWhatsappMessage(team.orgId, message?.id ?? "", 0)).toBe("failed");
    expect((await messagesOf(team.orgId))[0]).toMatchObject({
      status: "failed",
      error: "131026: Message undeliverable",
    });
  });
});

describe("WhatsApp webhook", () => {
  it("answers Meta's verification, follows delivery statuses and honours « STOP »", async () => {
    const { team, saleId, cashier } = await scenario(async (t) => [
      (await newBuyer(t.manager, "0661 50 12 34", true)).id,
    ]);
    await saveWhatsappSettings(team.owner, settings());
    const verifyToken = (await getWhatsappSettings(team.owner)).settings?.verifyToken ?? "";
    const verify = (token: string) =>
      verifyWhatsappWebhook(
        team.orgId,
        new URLSearchParams({
          "hub.mode": "subscribe",
          "hub.verify_token": token,
          "hub.challenge": "42",
        }),
      );
    expect(await verify(verifyToken)).toBe("42");
    expect(await verify("wrong")).toBeNull();

    await pay(cashier, saleId);
    const [message] = await messagesOf(team.orgId);
    await sendWhatsappMessage(team.orgId, message?.id ?? "", 0);
    const wamid = (await messagesOf(team.orgId))[0]?.wamid ?? "";
    const status = (value: string, at: number) => ({
      entry: [
        {
          changes: [{ value: { statuses: [{ id: wamid, status: value, timestamp: String(at) }] } }],
        },
      ],
    });

    const read = signed(status("read", 1_790_000_100));
    expect(await receiveWhatsappWebhook(team.orgId, read.raw, "sha256=00")).toBe(false);
    expect(await receiveWhatsappWebhook(team.orgId, read.raw, read.signature)).toBe(true);
    // A late « delivered » never takes a message back.
    const late = signed(status("delivered", 1_790_000_050));
    await receiveWhatsappWebhook(team.orgId, late.raw, late.signature);
    expect((await messagesOf(team.orgId))[0]).toMatchObject({
      status: "read",
      readAt: new Date(1_790_000_100_000),
    });

    const stop = signed({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "213661501234", type: "text", text: { body: " Stop " } }],
              },
            },
          ],
        },
      ],
    });
    await receiveWhatsappWebhook(team.orgId, stop.raw, stop.signature);
    const buyers = await withTenant(team.owner, (tx) =>
      tx.select({ optIn: buyer.whatsappOptIn }).from(buyer).where(eq(buyer.phone, "+213661501234")),
    );
    expect(buyers).toEqual([{ optIn: false }]);
  });
});

describe("WhatsApp residence notifications", () => {
  it("tells co-owners who agreed about their charge calls and residents about announcements", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const [unitA, unitB] = setup.unitIds;
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
    const resident = async (
      unitId: string,
      kind: "co_owner" | "occupant",
      phone: string,
      optIn: boolean,
    ) =>
      (
        await addResident(
          manager,
          addResidentSchema.parse({
            residenceId,
            unitId,
            kind,
            isMain: true,
            lastName: "Saïdi",
            firstName: kind === "co_owner" ? "Yasmine" : "Anis",
            phone,
            whatsappOptIn: optIn,
            email: "",
            sinceOn: "2026-01-01",
          }),
        )
      ).id;
    await resident(unitA ?? "", "co_owner", "0661 11 22 33", true);
    const silent = await resident(unitB ?? "", "co_owner", "0661 44 55 66", false);
    await resident(unitB ?? "", "occupant", "0770 77 88 99", true);
    await saveWhatsappSettings(team.owner, settings());

    await issueChargePeriod(
      manager,
      issueChargePeriodSchema.parse({
        period: `${budgetId}:1`,
        issuedOn: addDays(todayInAlgiers(), -5),
        dueOn: addDays(todayInAlgiers(), 25),
      }),
    );
    const calls = (await messagesOf(team.orgId)).filter((m) => m.kind === "charge_call");
    expect(calls.map((m) => m.recipient)).toEqual(["213661112233"]);
    expect(calls[0]?.params.slice(2)).toEqual([
      "10 000,00 DA",
      "le lot A-03-01 (Résidence Les Oliviers)",
      expect.stringMatching(/^\d{2}\/\d{2}\/\d{4}$/),
    ]);

    // The gestionnaire records the silent co-owner's consent.
    await setResidentWhatsapp(manager, { residentId: silent, optIn: true });
    const { id: announcementId } = await createAnnouncement(
      manager,
      createAnnouncementSchema.parse({
        residenceId,
        category: "outage",
        title: "Coupure d'eau jeudi",
        titleAr: "",
        body: "De 9 h à 12 h.",
        bodyAr: "",
        expiresOn: "",
        pinned: false,
      }),
    );
    await publishAnnouncement(manager, announcementId);
    const notices = (await messagesOf(team.orgId)).filter((m) => m.kind === "announcement");
    expect(notices.map((m) => m.recipient).sort()).toEqual([
      "213661112233",
      "213661445566",
      "213770778899",
    ]);
    expect(notices[0]?.params).toEqual(["Résidence Les Oliviers", "Coupure d'eau jeudi"]);
    const [log] = await withTenant(team.owner, (tx) =>
      tx
        .select({ n: whatsappMessage.id })
        .from(whatsappMessage)
        .where(
          and(eq(whatsappMessage.kind, "announcement"), eq(whatsappMessage.refId, residenceId)),
        ),
    );
    expect(log).toBeDefined();
  });
});
