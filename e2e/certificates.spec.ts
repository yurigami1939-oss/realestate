import { expect, test } from "@playwright/test";

import { authFile, expectPdf } from "./helpers";

/**
 * Certificates for buyers and their banks: the cashier issues an attestation de versements on
 * Mohamed Cherif's sale (the demo resident, src/db/seed/portal.ts), who finds it on the portal
 * and draws his own statement of account.
 */
test.describe("certificates", () => {
  // Documents render in the background behind each other: allow for the queue.
  test.describe.configure({ timeout: 150_000 });

  test("the cashier issues an attestation the buyer downloads from the portal", async ({
    browser,
  }) => {
    const staff = await browser.newContext({ storageState: authFile("cashier") });
    const page = await staff.newPage();
    await page.goto("/fr/sales?q=Cherif");
    await page.getByTestId("sales-table").getByRole("link", { name: /^RES-/ }).first().click();
    await page.getByRole("button", { name: "Délivrer une attestation" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Document").click();
    await page.getByRole("option", { name: "Attestation de versements" }).click();
    await dialog.getByLabel("À l'attention de (facultatif)").fill("CNEP Banque, agence de Kouba");
    await dialog.getByRole("button", { name: "Délivrer une attestation" }).click();
    await expect(page.getByText(/^Attestation ATT-\d{4}-\d{6} délivrée\.$/)).toBeVisible();
    const certificates = page.getByTestId("sale-certificates");
    await expect(certificates).toContainText("CNEP Banque, agence de Kouba");
    // Rendered by the worker, then served as the sale's other documents.
    await expectPdf(
      page,
      certificates.getByRole("link", { name: /^Attestation de versements · ATT-/ }).first(),
    );
    await staff.close();

    const portal = await browser.newContext({ storageState: authFile("resident") });
    const buyer = await portal.newPage();
    await buyer.goto("/fr/portal");
    await buyer
      .getByTestId("portal-sales")
      .getByRole("link", { name: "Résidence Les Oliviers · B-02-02" })
      .click();
    const mine = buyer.getByTestId("portal-certificates");
    await expectPdf(
      buyer,
      mine.getByRole("link", { name: /^Attestation de versements · ATT-/ }).first(),
    );
    await buyer.getByRole("button", { name: "Mon relevé de compte" }).click();
    await expect(buyer.getByText(/^Votre relevé est prêt/)).toBeVisible();
    await expectPdf(buyer, mine.getByRole("link", { name: /^Relevé de compte · ATT-/ }).first());
    await portal.close();
  });

  test("the attestations read right to left in Arabic", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("salesManager") });
    const page = await context.newPage();
    await page.goto("/ar/sales?q=Cherif");
    await page.getByTestId("sales-table").getByRole("link", { name: /^RES-/ }).first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("button", { name: "تسليم شهادة" })).toBeVisible();
    await context.close();
  });
});
