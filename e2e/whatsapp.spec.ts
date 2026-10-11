import { expect, test } from "@playwright/test";

import { authFile } from "./helpers";

/**
 * WhatsApp notifications through the local Cloud API stand-in (DEV_GATEWAYS): the demo number has
 * every notification on, and Mohamed Cherif agreed to them (src/db/seed/whatsapp.ts).
 */
test.describe("WhatsApp", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a payment at the counter sends the buyer a WhatsApp message", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("cashier") });
    const page = await context.newPage();
    await page.goto("/fr/sales?q=Cherif");
    await page.getByTestId("sales-table").getByRole("link", { name: /^RES-/ }).first().click();
    await page.getByRole("button", { name: "Enregistrer un paiement" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Montant (DA)").fill("15 000");
    await dialog.getByRole("button", { name: "Enregistrer un paiement" }).click();
    await expect(page.getByText(/^Paiement enregistré, reçu REC-\d{4}-\d{6}\.$/)).toBeVisible();

    // Queued with the payment, then sent by the worker.
    await page.getByRole("link", { name: "Messages WhatsApp" }).click();
    const latest = page.getByTestId("whatsapp-messages").getByRole("row").nth(1);
    await expect(latest).toContainText("Paiement reçu");
    await expect(latest).toContainText("Mohamed Cherif");
    await expect(async () => {
      await page.reload();
      await expect(latest).toContainText("Envoyé", { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await context.close();
  });

  test("the gérant sets up the number, the webhook and the templates", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("owner") });
    const page = await context.newPage();
    await page.goto("/fr/settings/whatsapp");
    await expect(page.getByTestId("whatsapp-stand-in")).toBeVisible();
    await expect(page.getByTestId("whatsapp-webhook")).toContainText("/api/webhooks/whatsapp/");
    await expect(page.getByLabel("Jeton d'accès permanent")).toHaveValue("");
    const notifications = page.getByTestId("whatsapp-notifications");
    await expect(notifications.getByRole("listitem")).toHaveCount(10);
    await expect(notifications.getByRole("checkbox", { name: "Paiement reçu" })).toBeChecked();
    await page.goto("/ar/whatsapp");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("رسائل واتساب");
    await context.close();
  });
});

/**
 * SMS through the local gateway stand-in: receipts go by SMS to buyers WhatsApp does not reach
 * (Karima Boudiaf never agreed to WhatsApp; src/db/seed/sms.ts).
 */
test.describe("SMS", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a payment at the counter texts a buyer WhatsApp does not reach", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("cashier") });
    const page = await context.newPage();
    await page.goto("/fr/sales?q=Boudiaf");
    await page.getByTestId("sales-table").getByRole("link", { name: /^RES-/ }).first().click();
    await page.getByRole("button", { name: "Enregistrer un paiement" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Montant (DA)").fill("10 000");
    await dialog.getByRole("button", { name: "Enregistrer un paiement" }).click();
    await expect(page.getByText(/^Paiement enregistré, reçu REC-\d{4}-\d{6}\.$/)).toBeVisible();

    await page.getByRole("link", { name: "Messages SMS" }).click();
    const latest = page.getByTestId("sms-messages").getByRole("row").nth(1);
    await expect(latest).toContainText("Paiement reçu");
    await expect(latest).toContainText("Karima Boudiaf");
    await expect(latest).toContainText("a bien recu votre paiement de 10 000,00 DA");
    await expect(async () => {
      await page.reload();
      await expect(latest).toContainText("Envoyé", { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.getByTestId("sms-opt-outs")).toContainText("Demande par téléphone");
    await context.close();
  });

  test("the gérant sets up the SMS account and sends a test message", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("owner") });
    const page = await context.newPage();
    await page.goto("/fr/settings/sms");
    await expect(page.getByTestId("sms-stand-in")).toBeVisible();
    await expect(page.getByLabel("Clé d'API")).toHaveValue("");
    await expect(page.getByRole("checkbox", { name: "Paiement reçu" })).toBeChecked();
    await page.getByRole("button", { name: "Envoyer un SMS d'essai" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Mobile").fill("0770 12 34 56");
    await dialog.getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByText("SMS d'essai mis en file.")).toBeVisible();
    await page.goto("/ar/sms");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الرسائل القصيرة");
    await context.close();
  });
});
