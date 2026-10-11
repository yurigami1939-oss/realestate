import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { auditLog, smsAccount, smsMessage, whatsappMessage } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { smsGsmText, smsNumber, smsSegments, smsText } from "@/lib/sms";
import { whatsappKinds } from "@/lib/whatsapp";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";
import { decryptSecret } from "@/server/secrets";
import { standInUrl } from "@/server/stand-ins";
import { whatsappSettingsSchema } from "@/server/whatsapp/schemas";
import { saveWhatsappSettings } from "@/server/whatsapp/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getSmsSettings, listSmsMessages } from "./queries";
import { smsOptOutSchema, smsSettingsSchema, testSmsSchema } from "./schemas";
import {
  addSmsOptOut,
  removeSmsOptOut,
  saveSmsSettings,
  sendSmsMessage,
  sendTestSms,
} from "./service";
import { handleSmsStandIn } from "./standin";

// The gateway is the local stand-in, called in-process; `gatewayDown` makes it unreachable.
const realFetch = globalThis.fetch;
let gatewayDown = false;
beforeAll(() => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const base = standInUrl("sms");
    if (!url.href.startsWith(base)) return realFetch(input, init);
    if (gatewayDown) return Promise.resolve(new Response("Bad Gateway", { status: 502 }));
    return handleSmsStandIn(
      new Request(url, init),
      url.pathname.slice(new URL(base).pathname.length + 1),
    );
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await stopEnqueue();
});

const settings = (overrides: Record<string, unknown> = {}) =>
  smsSettingsSchema.parse({
    enabled: true,
    provider: "mobilis",
    apiUrl: "",
    sender: "PROMO-DZ",
    apiKey: "key-123",
    language: "fr",
    kinds: ["payment_received"],
    ...overrides,
  });

const newBuyer = (ctx: TenantCtx, phone: string, whatsappOptIn: boolean, name: string) =>
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

const smsOf = (orgId: string) =>
  withTenant({ orgId }, (tx) => tx.select().from(smsMessage).orderBy(smsMessage.createdAt));

describe("SMS texts", () => {
  it("sends to mobiles only, counts the parts and fills the template", () => {
    expect(smsNumber("+213661501234")).toBe("+213661501234");
    expect(smsNumber("+21321234567")).toBeNull();
    expect(smsNumber("+33612345678")).toBe("+33612345678");
    expect(smsSegments("a".repeat(160))).toEqual({ encoding: "gsm", segments: 1 });
    expect(smsSegments("a".repeat(161))).toEqual({ encoding: "gsm", segments: 2 });
    expect(smsSegments("€".repeat(80))).toEqual({ encoding: "gsm", segments: 1 });
    expect(smsSegments("€".repeat(81))).toEqual({ encoding: "gsm", segments: 2 });
    expect(smsSegments("م".repeat(70))).toEqual({ encoding: "ucs2", segments: 1 });
    expect(smsSegments("م".repeat(71))).toEqual({ encoding: "ucs2", segments: 2 });
    expect(smsSegments(smsGsmText("Reçu n° 1 250,00\u00a0DA « payé »")).encoding).toBe("gsm");
    expect(smsText("rent_received", "fr", ["Karim", "35 000 DA", "le lot M-01-02", "QIT-1"])).toBe(
      "Bonjour Karim, nous avons bien reçu votre paiement de 35 000 DA pour le lot M-01-02. Reçu n° QIT-1 à votre disposition.",
    );
  });
});

describe("SMS notifications", () => {
  it("keeps the key encrypted and sends by SMS to those WhatsApp does not reach", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    await expect(saveSmsSettings(team.manager, settings())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(saveSmsSettings(team.owner, settings({ apiKey: "" }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(() => settings({ sender: "x" })).toThrow();
    await saveSmsSettings(team.owner, settings());
    // An empty key keeps the saved one; never sent back.
    await saveSmsSettings(team.owner, settings({ apiKey: "" }));
    const [row] = await withTenant(team.owner, (tx) =>
      tx.select().from(smsAccount).where(eq(smsAccount.organizationId, team.orgId)),
    );
    expect(decryptSecret(row?.apiKeyEncrypted ?? "")).toBe("key-123");
    const page = await getSmsSettings(team.owner);
    expect(page).toMatchObject({ standIn: true, settings: { sender: "PROMO-DZ" } });
    expect(JSON.stringify(page)).not.toContain("key-123");

    // WhatsApp sends receipts to the buyer who agreed; the co-buyer gets an SMS; a landline none.
    await saveWhatsappSettings(
      team.owner,
      whatsappSettingsSchema.parse({
        enabled: true,
        phoneNumberId: "100200300400500",
        businessAccountId: "",
        accessToken: "token",
        appSecret: "",
        language: "fr",
        notifications: whatsappKinds.map((kind) => ({ kind, enabled: true, template: "" })),
      }),
    );
    const ids = [
      (await newBuyer(team.manager, "0661 50 12 34", true, "Karim")).id,
      (await newBuyer(team.manager, "0550 99 88 77", false, "Amina")).id,
      (await newBuyer(team.manager, "021 23 45 67", false, "Nadir")).id,
    ];
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
    const { receiptNumber } = await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount: "10 000",
        method: "cash",
        paidOn: todayInAlgiers(),
        payerName: "Bensalem Karim",
      }),
    );
    const whatsapp = await withTenant(team.owner, (tx) => tx.select().from(whatsappMessage));
    expect(whatsapp.map((m) => m.recipient)).toEqual(["213661501234"]);
    const [queued, ...others] = await smsOf(team.orgId);
    expect(others).toHaveLength(0);
    expect(queued).toMatchObject({
      kind: "payment_received",
      recipient: "+213550998877",
      recipientName: "Amina Bensalem",
      status: "queued",
      refType: "reservation",
      refId: saleId,
    });
    // Respelled in the GSM alphabet: 160-character parts.
    expect(queued?.text).toContain(`Recu no ${receiptNumber}`);
    expect(queued?.text).toContain("10 000,00 DA");
    expect(queued?.segments).toBeLessThanOrEqual(2);

    // Sent by the worker; the stand-in refuses a number ending in 0000.
    expect(await sendSmsMessage(team.orgId, queued?.id ?? "", 0)).toBe("sent");
    expect(await sendSmsMessage(team.orgId, queued?.id ?? "", 0)).toBe("skipped");
    const [sent] = await smsOf(team.orgId);
    expect(sent).toMatchObject({ status: "sent", providerId: expect.stringMatching(/^sms-/) });

    // A test message from the settings page; the gateway down → retried, then failed.
    await sendTestSms(team.owner, testSmsSchema.parse({ phone: "0770 12 34 56" }));
    const test = (await smsOf(team.orgId)).at(-1);
    expect(test).toMatchObject({ kind: null, recipient: "+213770123456" });
    gatewayDown = true;
    await expect(sendSmsMessage(team.orgId, test?.id ?? "", 0)).rejects.toThrow();
    expect(await sendSmsMessage(team.orgId, test?.id ?? "", 5)).toBe("failed");
    gatewayDown = false;
    await sendTestSms(team.owner, testSmsSchema.parse({ phone: "0770 12 00 00" }));
    const refused = (await smsOf(team.orgId)).at(-1);
    expect(await sendSmsMessage(team.orgId, refused?.id ?? "", 0)).toBe("failed");
    expect((await smsOf(team.orgId)).at(-1)?.error).toBe("Numéro injoignable");

    // « STOP »: no more SMS to that number until it is taken off the list.
    await expect(
      addSmsOptOut(cashier, smsOptOutSchema.parse({ phone: "0550 99 88 77", reason: "" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await addSmsOptOut(
      team.manager,
      smsOptOutSchema.parse({ phone: "0550 99 88 77", reason: "Appel du client" }),
    );
    const before = (await smsOf(team.orgId)).length;
    await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount: "5 000",
        method: "cash",
        paidOn: todayInAlgiers(),
        payerName: "Bensalem Amina",
      }),
    );
    expect(await smsOf(team.orgId)).toHaveLength(before);
    const log = await listSmsMessages(team.manager, {});
    expect(log.total).toBe(before);
    expect(log.optOuts).toMatchObject([{ phone: "+213550998877", reason: "Appel du client" }]);
    await removeSmsOptOut(team.manager, { optOutId: log.optOuts[0]?.id ?? "" });
    expect((await listSmsMessages(team.manager, {})).optOuts).toEqual([]);

    const audits = await withTenant(team.owner, (tx) =>
      tx.select({ action: auditLog.action }).from(auditLog),
    );
    const actions = audits.map((a) => a.action);
    expect(actions.filter((a) => a === "organization.sms")).toHaveLength(2);
    expect(actions).toEqual(expect.arrayContaining(["sms.opt_out", "sms.opt_in"]));
    expect(JSON.stringify(audits)).not.toContain("key-123");
  });
});
