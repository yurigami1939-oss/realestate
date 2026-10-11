import { createDecipheriv, createECDH, createHmac, randomBytes, randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db/client";
import { customRole, member, memberCustomRole, portalLink, pushSubscription } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import type { JobPayloads } from "@/jobs/queues";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { deviceLabel, isPushServiceUrl, pushKinds } from "@/lib/push";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { createLeadSchema } from "@/server/crm/schemas";
import { createLead } from "@/server/crm/leads";
import { decideDiscountSchema, requestDiscountSchema } from "@/server/discounts/schemas";
import { decideDiscount, requestDiscount } from "@/server/discounts/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import type { PortalCtx } from "@/server/portal/context";
import { closePortalRequestSchema, createPortalRequestSchema } from "@/server/requests/schemas";
import { closePortalRequest, createPortalRequest } from "@/server/requests/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";
import { standInUrl } from "@/server/stand-ins";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { pushSubscriptionSchema } from "./schemas";
import {
  allowedPushEndpoint,
  listPushDevices,
  pushNotification,
  removePushDevice,
  sendPushMessage,
  sendTestPush,
  subscribePush,
  unsubscribePush,
} from "./service";
import { handlePushStandIn } from "./standin";

// The push service is the local stand-in, called in-process; `serviceDown` makes it unavailable.
const realFetch = globalThis.fetch;
const STAND_IN = standInUrl("push");
let serviceDown = false;
beforeAll(() => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (!url.href.startsWith(`${STAND_IN}/`)) return realFetch(input, init);
    if (serviceDown) return Promise.resolve(new Response("Unavailable", { status: 503 }));
    return handlePushStandIn(new Request(url, init), url.pathname.split("/").at(-1) ?? "");
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await stopEnqueue();
});

type Shown = { title: string; body: string; url: string; lang: string };

/** A browser: its key pair and auth secret, subscribed at a stand-in endpoint. */
function browser(id = `dev-${randomUUID()}`) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `${STAND_IN}/${id}`;
  /** What the browser decrypts (RFC 8291 §3) from the messages the push service received. */
  const received = async (): Promise<Shown[]> => {
    const response = await handlePushStandIn(new Request(endpoint), id);
    const { data } = (await response.json()) as { data: { body: string }[] };
    return data.map((m) => JSON.parse(decrypt(Buffer.from(m.body, "base64url"))) as Shown);
  };
  function decrypt(body: Buffer): string {
    const salt = body.subarray(0, 16);
    const idLength = body.readUInt8(20);
    const asPublic = body.subarray(21, 21 + idLength);
    const ciphertext = body.subarray(21 + idLength);
    const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();
    const info = (text: string) => Buffer.concat([Buffer.from(text), Buffer.from([1])]);
    const secret = ecdh.computeSecret(asPublic);
    const ikm = hmac(
      hmac(auth, secret),
      Buffer.concat([
        Buffer.from("WebPush: info\0"),
        ecdh.getPublicKey(),
        asPublic,
        Buffer.from([1]),
      ]),
    );
    const prk = hmac(salt, ikm);
    const decipher = createDecipheriv(
      "aes-128-gcm",
      hmac(prk, info("Content-Encoding: aes128gcm\0")).subarray(0, 16),
      hmac(prk, info("Content-Encoding: nonce\0")).subarray(0, 12),
    );
    decipher.setAuthTag(ciphertext.subarray(-16));
    const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
    return plain.subarray(0, -1).toString();
  }
  return {
    endpoint,
    received,
    subscription: (locale: "fr" | "ar") =>
      pushSubscriptionSchema.parse({
        endpoint,
        keys: {
          p256dh: ecdh.getPublicKey().toString("base64url"),
          auth: auth.toString("base64url"),
        },
        locale,
        userAgent:
          "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
      }),
  };
}

/** The `push.send` jobs queued for an organization, oldest first. */
async function pushJobs(orgId: string) {
  const { rows } = await db.execute<{ data: JobPayloads["push.send"] }>(sql`
    select data from pgboss.job
    where name = 'push.send' and data->>'organizationId' = ${orgId}
    order by created_on
  `);
  return rows.map((r) => r.data);
}

/** Sends the jobs queued since `from` (as the worker does) and returns them. */
async function deliver(orgId: string, from: number) {
  const jobs = (await pushJobs(orgId)).slice(from);
  for (const job of jobs) await sendPushMessage(job, 0);
  return jobs;
}

/** A portal account linked to a buyer file (as an accepted invitation leaves it). */
async function portalAccount(orgId: string, buyerId: string): Promise<PortalCtx> {
  const account = await addMember(orgId, ["resident"]);
  await withTenant({ orgId }, (tx) =>
    tx.insert(portalLink).values({
      organizationId: orgId,
      email: `client-${randomUUID().slice(0, 8)}@example.test`,
      userId: account.userId,
      buyerId,
    }),
  );
  return { userId: account.userId, orgId, name: "Karim Bensalem", locale: "ar" };
}

describe("push devices", () => {
  it("accepts the browsers' push services only, and names devices", () => {
    expect(isPushServiceUrl("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushServiceUrl("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushServiceUrl("https://web.push.apple.com/QGx")).toBe(true);
    expect(isPushServiceUrl("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    for (const refused of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://fcm.googleapis.com.evil.example/x",
      "https://user@fcm.googleapis.com/x",
      "https://evil.example/x",
      "http://127.0.0.1:5432/",
      "not a url",
    ]) {
      expect(isPushServiceUrl(refused)).toBe(false);
    }
    // The local stand-in, outside production.
    expect(isPushServiceUrl(`${STAND_IN}/abc12345`)).toBe(false);
    expect(allowedPushEndpoint(`${STAND_IN}/abc12345`)).toBe(true);
    expect(
      deviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari · iOS");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0",
      ),
    ).toBe("Edge · Windows");
    expect(deviceLabel(null)).toBeNull();
  });

  it("renders every notification in both languages", () => {
    const params = {
      amount: { fr: "1 000,00 DA", ar: "1.000,00 د.ج" },
      unit: "A-01-02",
      place: "Les Oliviers",
      receipt: "REC-2026-000001",
      number: "ADF-2026-000001",
      dueOn: "01/12/2026",
      payBy: "01/12/2026",
      day: "01/12/2026",
      time: "10:00",
      lease: "BAL-2026-000001",
      residence: "El Yasmine",
      title: "Coupure d'eau",
      outcome: "done",
      status: "resolved",
      position: "2",
      fixedOn: "01/12/2026",
      name: "Karim Bensalem",
      lead: "Karim Bensalem",
      approved: "yes",
      buyer: "Karim Bensalem",
      kind: "appointment",
      location: "Salle de bain",
      company: "SARL Promo",
    };
    for (const kind of pushKinds) {
      for (const locale of ["fr", "ar"] as const) {
        const shown = pushNotification(kind, locale, params, "/portal");
        expect(shown.title.length, `${kind} ${locale}`).toBeGreaterThan(0);
        expect(shown.body.length, `${kind} ${locale}`).toBeGreaterThan(0);
        expect(`${shown.title} ${shown.body}`).not.toMatch(/[{}]/);
        expect(shown).toMatchObject({ url: `/${locale}/portal`, lang: locale });
      }
    }
    expect(pushNotification("payment_received", "ar", params, "/portal").body).toContain(
      "1.000,00 د.ج",
    );
  });

  it("keeps each account's devices", async () => {
    const team = await createSalesTeam();
    const phone = browser();
    await expect(
      subscribePush(team.owner, {
        ...phone.subscription("fr"),
        endpoint: "https://evil.example/push",
      }),
    ).rejects.toMatchObject({ messageKey: "push.errors.endpoint" });
    await expect(
      subscribePush(team.owner, {
        ...phone.subscription("fr"),
        keys: { p256dh: phone.subscription("fr").keys.p256dh, auth: "c2hvcnQ" },
      }),
    ).rejects.toMatchObject({ messageKey: "push.errors.keys" });

    await subscribePush(team.owner, phone.subscription("fr"));
    expect(await listPushDevices(team.owner)).toMatchObject([
      { endpoint: phone.endpoint, locale: "fr", lastSentAt: null },
    ]);
    // Another person signs in on the same browser: the device moves to them.
    await subscribePush(team.manager, phone.subscription("ar"));
    expect(await listPushDevices(team.owner)).toEqual([]);
    expect(await listPushDevices(team.manager)).toMatchObject([{ locale: "ar" }]);
    // Removing someone else's device is refused; turning it off forgets it.
    const [device] = await listPushDevices(team.manager);
    await expect(
      removePushDevice(team.owner, { subscriptionId: device?.id ?? "" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await unsubscribePush(team.manager, { endpoint: phone.endpoint });
    expect(await listPushDevices(team.manager)).toEqual([]);
    // The latest ten devices are kept.
    for (let i = 0; i < 12; i++) await subscribePush(team.agentA, browser().subscription("fr"));
    expect(await listPushDevices(team.agentA)).toHaveLength(10);
  });
});

describe("push notifications", () => {
  it("reaches the accounts concerned on their devices, in their language", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const cashier = await addMember(team.orgId, ["cashier"]);
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
    const pay = () =>
      recordPayment(
        cashier,
        recordPaymentSchema.parse({
          reservationId: saleId,
          amount: "10 000",
          method: "cash",
          paidOn: todayInAlgiers(),
          payerName: "Bensalem Karim",
        }),
      );

    // Nobody turned notifications on: nothing is queued.
    await pay();
    expect(await pushJobs(team.orgId)).toEqual([]);

    // The buyer's portal account on its phone (Arabic); a stranger's account gets nothing.
    const client = await portalAccount(team.orgId, buyerId);
    const phone = browser();
    await subscribePush(client, phone.subscription("ar"));
    const stranger = await addMember(team.orgId, ["resident"]);
    await subscribePush(stranger, browser().subscription("fr"));
    const { receiptNumber } = await pay();
    const [received] = await deliver(team.orgId, 0);
    expect(received).toMatchObject({ kind: "payment_received", url: `/portal/sales/${saleId}` });
    expect(await phone.received()).toEqual([
      {
        title: "تم استلام دفعة",
        body: expect.stringContaining(receiptNumber),
        url: `/ar/portal/sales/${saleId}`,
        lang: "ar",
      },
    ]);
    expect((await listPushDevices(client))[0]?.lastSentAt).toBeInstanceOf(Date);

    // A request from the portal reaches the managers (the gérant, the directeur commercial),
    // never the commercials; its answer reaches the account that asked.
    const office = browser();
    const desk = browser();
    await subscribePush(team.owner, office.subscription("fr"));
    await subscribePush(team.manager, desk.subscription("fr"));
    await subscribePush(team.agentB, browser().subscription("fr"));
    let from = (await pushJobs(team.orgId)).length;
    const { id: requestId } = await createPortalRequest(
      client,
      createPortalRequestSchema.parse({
        reservationId: saleId,
        kind: "appointment",
        preferredOn: addDays(todayInAlgiers(), 3),
        message: "Visite du chantier",
      }),
    );
    expect((await deliver(team.orgId, from)).map((j) => j.kind)).toEqual([
      "portal_request",
      "portal_request",
    ]);
    expect(await office.received()).toEqual([
      expect.objectContaining({
        title: "Demande d'un acquéreur",
        body: expect.stringContaining("un rendez-vous"),
        url: "/fr/sales/requests",
      }),
    ]);
    from = (await pushJobs(team.orgId)).length;
    await closePortalRequest(
      team.manager,
      closePortalRequestSchema.parse({ requestId, outcome: "done", answer: "" }),
    );
    await deliver(team.orgId, from);
    expect((await phone.received())[0]?.title).toBe("تمت معالجة طلبكم");
    expect(await desk.received()).toHaveLength(1);

    // A discount request reaches the managers, and a member whose custom role decides them;
    // the decision reaches the commercial who asked.
    const assistant = await addMember(team.orgId, ["cashier"]);
    await withTenant(team.owner, async (tx) => {
      const [role] = await tx
        .insert(customRole)
        .values({
          organizationId: team.orgId,
          name: "Assistante",
          baseRole: "cashier",
          permissions: ["discount:decide", "lead:read_all"],
        })
        .returning({ id: customRole.id });
      await tx.insert(memberCustomRole).values({
        organizationId: team.orgId,
        userId: assistant.userId,
        customRoleId: role?.id ?? "",
      });
    });
    await subscribePush(assistant, browser().subscription("fr"));
    // The cashier's own role decides nothing: only the custom role's permissions count.
    await subscribePush(cashier, browser().subscription("fr"));
    const agentPhone = browser();
    await subscribePush(team.agentA, agentPhone.subscription("fr"));
    const leadId = await newLead(team.agentA, "0661 00 11 22");
    from = (await pushJobs(team.orgId)).length;
    const { id: discountId } = await requestDiscount(
      team.agentA,
      requestDiscountSchema.parse({
        leadId,
        unitId: setup.unitIds[1],
        amount: "100 000",
        reason: "Client fidèle",
      }),
    );
    const asked = await deliver(team.orgId, from);
    const owners = await db
      .select({ userId: pushSubscription.userId })
      .from(pushSubscription)
      .where(
        inArray(
          pushSubscription.id,
          asked.map((j) => j.subscriptionId),
        ),
      );
    expect(owners.map((o) => o.userId).sort()).toEqual(
      [team.owner.userId, team.manager.userId, assistant.userId].sort(),
    );
    from = (await pushJobs(team.orgId)).length;
    await decideDiscount(
      team.manager,
      decideDiscountSchema.parse({
        requestId: discountId,
        approve: true,
        amount: "80 000",
        note: "",
      }),
    );
    await deliver(team.orgId, from);
    expect(await agentPhone.received()).toEqual([
      expect.objectContaining({
        title: "Remise accordée",
        body: expect.stringMatching(/80\s000,00/),
        url: `/fr/leads/${leadId}`,
      }),
    ]);

    // A lead a manager gives to a commercial; never their own lead.
    from = (await pushJobs(team.orgId)).length;
    await createLead(
      team.manager,
      createLeadSchema.parse({
        fullName: "Samir Haddad",
        phone: "0661 22 33 44",
        source: "phone",
        typologies: [],
        assignedTo: team.agentA.userId,
      }),
    );
    await newLead(team.agentA, "0661 55 66 77");
    expect((await pushJobs(team.orgId)).slice(from).map((j) => j.kind)).toEqual(["lead_assigned"]);
    await deliver(team.orgId, from);
    expect((await agentPhone.received())[0]).toMatchObject({
      title: "Nouveau prospect",
      body: "Samir Haddad vous a été attribué.",
    });

    // A test notification from the settings page.
    from = (await pushJobs(team.orgId)).length;
    await sendTestPush(client, { endpoint: phone.endpoint });
    await expect(sendTestPush(team.owner, { endpoint: phone.endpoint })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await deliver(team.orgId, from);
    expect((await phone.received())[0]?.title).toBe("تم تفعيل الإشعارات");
  });

  it("forgets gone devices, retries an unavailable service and skips former members", async () => {
    const team = await createSalesTeam();
    const gone = browser(`dev-${randomUUID()}-gone`);
    const kept = browser();
    await subscribePush(team.agentA, gone.subscription("fr"));
    await subscribePush(team.agentB, kept.subscription("fr"));
    const [goneDevice] = await listPushDevices(team.agentA);
    const [keptDevice] = await listPushDevices(team.agentB);
    const job = (subscriptionId: string): JobPayloads["push.send"] => ({
      organizationId: team.orgId,
      subscriptionId,
      kind: "test",
      params: { company: "SARL" },
      url: "/",
    });

    // The push service says the subscription expired: the device is forgotten.
    expect(await sendPushMessage(job(goneDevice?.id ?? ""), 0)).toBe("gone");
    expect(await listPushDevices(team.agentA)).toEqual([]);
    expect(await sendPushMessage(job(goneDevice?.id ?? ""), 0)).toBe("skipped");

    // Unavailable: retried (the job throws), failed after the last try; the device stays.
    serviceDown = true;
    await expect(sendPushMessage(job(keptDevice?.id ?? ""), 0)).rejects.toThrow();
    expect(await sendPushMessage(job(keptDevice?.id ?? ""), 3)).toBe("failed");
    serviceDown = false;
    expect(await listPushDevices(team.agentB)).toHaveLength(1);
    expect(await kept.received()).toEqual([]);

    // A member who left the organization gets nothing from it.
    await db
      .delete(member)
      .where(and(eq(member.organizationId, team.orgId), eq(member.userId, team.agentB.userId)));
    expect(await sendPushMessage(job(keptDevice?.id ?? ""), 0)).toBe("skipped");
  });
});
