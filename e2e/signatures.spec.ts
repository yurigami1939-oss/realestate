import { type APIRequestContext, expect, test } from "@playwright/test";

import { authFile, email } from "./helpers";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

type Found = { messages: { ID: string; Created: string }[] };

/** The signing code e-mailed to an address after `since` (Mailpit catches the worker's SMTP). */
async function signingCode(request: APIRequestContext, to: string, since: Date) {
  const query = encodeURIComponent(`to:"${to}" subject:"Votre code de signature"`);
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        const found = (await (
          await request.get(`${MAILPIT}/api/v1/search?query=${query}`)
        ).json()) as Found;
        const latest = found.messages.find((m) => new Date(m.Created) > since);
        if (!latest) return null;
        const message = (await (
          await request.get(`${MAILPIT}/api/v1/message/${latest.ID}`)
        ).json()) as { Text: string };
        // The code stands on its own line.
        code = /^(\d{6})$/m.exec(message.Text)?.[1] ?? null;
        return code;
      },
      { timeout: 30_000 },
    )
    .not.toBeNull();
  return code ?? "";
}

test.describe("electronic signature", () => {
  test("the tenant signs the entry inspection of his lease with a code received by e-mail", async ({
    browser,
    request,
  }) => {
    const home = await browser.newContext({ storageState: authFile("resident") });
    const page = await home.newPage();
    await page.goto("/fr/portal");
    await page
      .getByTestId("portal-leases")
      .getByRole("link", { name: "Résidence Les Amandiers · D-02-03" })
      .click();
    await page.getByRole("button", { name: "Signer électroniquement" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("loi 15-04");
    const since = new Date(Date.now() - 1_000);
    await dialog.getByRole("button", { name: "Recevoir le code par e-mail" }).click();
    await expect(dialog).toContainText("Code envoyé à a•••@demo.test");

    const code = await signingCode(request, email("resident"), since);
    await dialog.getByLabel("Code reçu (6 chiffres)").fill(code);
    await dialog.getByRole("button", { name: "Signer", exact: true }).click();
    await expect(page.getByText("Document signé.")).toBeVisible();
    await expect(page.locator('[data-signed="lease_inspection"]')).toContainText(
      "Signé électroniquement le",
    );
    await home.close();

    // The gestionnaire sees who signed, when, and the fingerprint of the report signed.
    const staff = await browser.newContext({ storageState: authFile("propertyManager") });
    const manager = await staff.newPage();
    await manager.goto("/fr/rentals");
    await manager
      .getByTestId("leases")
      .locator('[data-unit="D-02-03"]')
      .getByRole("link")
      .first()
      .click();
    const signatures = manager.getByTestId("lease-inspections").getByTestId("e-signatures");
    await expect(signatures).toContainText("Signé électroniquement par Mohamed Cherif");
    await expect(signatures).toContainText("Empreinte SHA-256");
    await staff.close();
  });
});
