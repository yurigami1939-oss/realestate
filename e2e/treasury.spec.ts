import { expect, test } from "@playwright/test";

import { authFile } from "./helpers";

/**
 * Cash desks and bank accounts (src/db/seed/treasury.ts): « Caisse siège », « BNA compte
 * courant » and « CCP société », the seeded collections on their default accounts, this week's
 * movements and today's cash count short of 200 DA.
 */
test.describe("treasury", () => {
  test("the cashier follows the cash desk and counts the cash", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("cashier") });
    const page = await context.newPage();
    await page.goto("/fr/dashboard");
    await page.getByRole("link", { name: "Trésorerie", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trésorerie");
    const accounts = page.getByTestId("treasury-accounts");
    await expect(accounts.locator('[data-account="Caisse siège"]')).toBeVisible();
    await expect(accounts.locator('[data-account="BNA compte courant"]')).toBeVisible();
    // The cashier reads and counts, but records no movement.
    await expect(page.getByRole("button", { name: "Saisir un mouvement" })).toHaveCount(0);

    await accounts.getByRole("link", { name: "Caisse siège" }).click();
    const ledger = page.getByTestId("ledger");
    await expect(ledger.locator('[data-source="expense"]')).toContainText("Fournitures de bureau");
    await expect(ledger.locator('[data-source="transfer"]')).toContainText(
      "Versement des espèces en banque",
    );
    await expect(page.getByTestId("cash-counts")).toContainText("Monnaie rendue en trop");

    await page.getByRole("button", { name: "Arrêter la caisse" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Espèces comptées (DA)").fill("1");
    await expect(dialog.getByTestId("cash-count-difference")).toBeVisible();
    await dialog.getByRole("button", { name: "Arrêter la caisse" }).click();
    await expect(dialog.getByText("Expliquez l'écart.")).toBeVisible();
    await dialog.getByLabel("Explication de l'écart").fill("Fonds remis au coffre");
    await dialog.getByRole("button", { name: "Arrêter la caisse" }).click();
    await expect(page.getByText(/^Caisse arrêtée, écart de /)).toBeVisible();
    await expect(page.getByTestId("cash-counts")).toContainText("Fonds remis au coffre");

    // The payment form says where the money lands.
    await page.goto("/fr/sales?q=Cherif");
    await page.getByTestId("sales-table").getByRole("link", { name: /^RES-/ }).first().click();
    await page.getByRole("button", { name: "Enregistrer un paiement" }).click();
    await expect(page.getByRole("dialog").getByLabel("Encaissé sur")).toBeVisible();
    await context.close();
  });

  test("the gérant moves money between accounts", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("owner") });
    const page = await context.newPage();
    await page.goto("/fr/treasury");
    await page.getByRole("button", { name: "Saisir un mouvement" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Mouvement", { exact: true }).click();
    await page.getByRole("option", { name: "Virement entre comptes" }).click();
    await dialog.getByLabel("Du compte").click();
    await page.getByRole("option", { name: "BNA compte courant" }).click();
    await dialog.getByLabel("Vers le compte").click();
    await page.getByRole("option", { name: "CCP société" }).click();
    await dialog.getByLabel("Montant (DA)").fill("10 000");
    await dialog.getByLabel("Libellé").fill("Alimentation du CCP");
    await dialog.getByRole("button", { name: "Saisir un mouvement" }).click();
    await expect(page.getByText("Mouvement enregistré.")).toBeVisible();

    await page.getByTestId("treasury-accounts").getByRole("link", { name: "CCP société" }).click();
    await expect(page.getByTestId("ledger").locator('[data-source="transfer"]')).toContainText(
      "Alimentation du CCP",
    );
    await page.goto("/ar/treasury");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الخزينة");
    await context.close();
  });
});
