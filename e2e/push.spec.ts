import { createDecipheriv, createECDH, createHmac, randomBytes, randomUUID } from "node:crypto";

import { type APIRequestContext, type BrowserContext, expect, test } from "@playwright/test";

import { authFile } from "./helpers";

type Shown = { title: string; body: string; url: string; lang: string };

/**
 * A device's push subscription. Headless Chromium has neither notifications nor a push service,
 * so the page's permission is granted and its PushManager answers with an endpoint on the app's
 * push stand-in and keys made here; the server encrypts and signs for real, and the test reads
 * what the stand-in received with those keys (RFC 8291).
 */
async function pushDevice(context: BrowserContext, baseURL: string) {
  const id = `e2e-${randomUUID()}`;
  const endpoint = `${baseURL}/api/dev/push/${id}`;
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  await context.addInitScript(
    (keys: { endpoint: string; p256dh: string; auth: string }) => {
      // Headless Chromium shows no notifications (permission denied whatever is granted).
      Object.defineProperty(Notification, "permission", { get: () => "granted" });
      Notification.requestPermission = async (): Promise<NotificationPermission> => "granted";
      const flag = "e2e-push-subscribed";
      const subscription = {
        endpoint: keys.endpoint,
        toJSON: () => ({ endpoint: keys.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }),
        unsubscribe: async () => {
          localStorage.removeItem(flag);
          return true;
        },
      } as unknown as PushSubscription;
      PushManager.prototype.subscribe = async () => {
        localStorage.setItem(flag, "1");
        return subscription;
      };
      PushManager.prototype.getSubscription = async () =>
        localStorage.getItem(flag) ? subscription : null;
    },
    {
      endpoint,
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: auth.toString("base64url"),
    },
  );

  function decrypt(body: Buffer): Shown {
    const salt = body.subarray(0, 16);
    const idLength = body.readUInt8(20);
    const asPublic = body.subarray(21, 21 + idLength);
    const ciphertext = body.subarray(21 + idLength);
    const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();
    const info = (text: string) => Buffer.concat([Buffer.from(text), Buffer.from([1])]);
    const ikm = hmac(
      hmac(auth, ecdh.computeSecret(asPublic)),
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
    return JSON.parse(plain.subarray(0, -1).toString()) as Shown;
  }

  /** What reached the device, newest first (sent by the e2e worker). */
  async function received(request: APIRequestContext): Promise<Shown[]> {
    const response = await request.get(endpoint);
    const { data } = (await response.json()) as { data: { body: string }[] };
    return data.map((m) => decrypt(Buffer.from(m.body, "base64url")));
  }
  return { received };
}

test.describe("push notifications", () => {
  test("a resident and the gestionnaire follow a ticket on their devices", async ({
    browser,
    request,
    baseURL,
  }) => {
    // The gestionnaire turns notifications on from the settings.
    const staff = await browser.newContext({ storageState: authFile("propertyManager") });
    const office = await pushDevice(staff, baseURL ?? "");
    const manager = await staff.newPage();
    await manager.goto("/fr/settings/notifications");
    await expect(manager.getByRole("heading", { level: 1 })).toHaveText("Notifications");
    await expect(manager.getByText("Désactivées sur cet appareil")).toBeVisible();
    await manager.getByRole("button", { name: "Activer les notifications" }).click();
    await expect(manager.getByText("Activées sur cet appareil")).toBeVisible();
    await expect(manager.getByText("Cet appareil", { exact: true })).toBeVisible();

    // The resident does the same on the portal and sends itself a test notification.
    const home = await browser.newContext({ storageState: authFile("resident") });
    const phone = await pushDevice(home, baseURL ?? "");
    const page = await home.newPage();
    await page.goto("/fr/portal");
    await page.getByRole("link", { name: "Notifications" }).click();
    await page.getByRole("button", { name: "Activer les notifications" }).click();
    await expect(page.getByText("Activées sur cet appareil")).toBeVisible();
    await page.getByRole("button", { name: "Envoyer une notification d'essai" }).click();
    await expect(page.getByText("Notification d'essai envoyée.")).toBeVisible();
    await expect.poll(async () => (await phone.received(request)).length).toBe(1);
    expect((await phone.received(request))[0]).toMatchObject({
      title: "Notifications activées",
      url: "/fr",
      lang: "fr",
    });

    // A problem reported from the portal reaches the gestionnaire's device…
    await page.getByRole("link", { name: "Réclamations" }).click();
    await page.getByRole("button", { name: "Signaler un problème" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Objet").fill("Fuite dans la cage d'escalier");
    await dialog.getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Fuite dans la cage d'escalier",
    );
    await expect.poll(async () => (await office.received(request)).length).toBe(1);
    const [reported] = await office.received(request);
    expect(reported).toMatchObject({
      title: "Nouvelle réclamation · Résidence El Yasmine",
      body: "Fuite dans la cage d'escalier",
      url: expect.stringMatching(/^\/fr\/tickets\/[0-9a-f-]{36}$/),
    });

    // …who opens it from the notification and takes it in charge: the resident is told.
    await manager.goto(reported?.url ?? "");
    await manager.getByRole("button", { name: "Prendre en charge" }).click();
    await manager.getByRole("dialog").getByRole("button", { name: "Prendre en charge" }).click();
    await expect(manager.getByTestId("ticket-events")).toContainText("En cours");
    await expect.poll(async () => (await phone.received(request)).length).toBe(2);
    expect((await phone.received(request))[0]).toMatchObject({
      title: "Réclamation : Fuite dans la cage d'escalier",
      body: "Prise en charge.",
      url: expect.stringMatching(/^\/fr\/portal\/tickets\/[0-9a-f-]{36}$/),
    });

    // Turned off on the phone: its device leaves the list.
    await page.goto("/fr/portal/notifications");
    await page.getByRole("button", { name: "Désactiver" }).click();
    await expect(page.getByText("Désactivées sur cet appareil")).toBeVisible();
    await expect(page.getByText("Aucun appareil ne reçoit vos notifications.")).toBeVisible();
    await home.close();
    await staff.close();
  });

  test("shows the notifications page in Arabic", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("resident") });
    const page = await context.newPage();
    await page.goto("/ar/portal/notifications");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الإشعارات");
    await expect(page.getByRole("button", { name: "تفعيل الإشعارات" })).toBeVisible();
    await context.close();
  });
});
