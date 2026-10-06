import { expect, test } from "@playwright/test";

import { authFile } from "./helpers";

/**
 * Construction costs of Les Oliviers (src/db/seed/costs.ts): the budget, the structural works
 * contract with six progress invoices (the last one to pay), the design office accepted, the
 * electrical works just started.
 */
test.describe("construction costs", () => {
  test("the technical manager records a progress invoice", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("technicalManager") });
    const page = await context.newPage();
    await page.goto("/fr/projects");
    await page.getByRole("link", { name: "Résidence Les Oliviers" }).first().click();
    await page.getByRole("link", { name: "Coûts et marge" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Coûts et marge");
    await expect(page.getByTestId("costs-summary")).toContainText("Marge prévue");
    await expect(
      page.getByTestId("costs-by-category").locator('[data-category="works"]'),
    ).toBeVisible();

    await page
      .getByTestId("contracts")
      .getByRole("link", { name: "Électricité Blocs A et B" })
      .click();
    // He records progress invoices but does not pay them.
    await expect(page.getByRole("button", { name: "Payer" })).toHaveCount(0);
    await page.getByRole("button", { name: "Nouvelle situation" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("N° de facture").fill("2/2026");
    await dialog.getByLabel("Montant de la situation (DA)").fill("5 000 000");
    await expect(dialog.getByTestId("invoice-split")).toContainText("Retenue : 250 000,00");
    await dialog.getByRole("button", { name: "Nouvelle situation" }).click();
    await expect(page.getByText("Situation enregistrée.")).toBeVisible();
    await expect(page.getByTestId("works-invoices").locator('[data-situation="2"]')).toContainText(
      "2/2026",
    );
    await context.close();
  });

  test("the gérant pays the last structural situation from the bank", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("owner") });
    const page = await context.newPage();
    await page.goto("/fr/projects");
    await page.getByRole("link", { name: "Résidence Les Oliviers" }).first().click();
    await page.getByRole("link", { name: "Coûts et marge" }).click();
    await expect(page.getByTestId("cash-forecast")).toBeVisible();
    await page
      .getByTestId("contracts")
      .getByRole("link", { name: "Gros œuvre Blocs A et B" })
      .click();
    const sixth = page.getByTestId("works-invoices").locator('[data-situation="6"]');
    await sixth.getByRole("button", { name: "Payer" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Payé depuis")).toBeVisible();
    await dialog.getByRole("button", { name: "Payer" }).click();
    await expect(page.getByText("Situation payée.")).toBeVisible();
    await expect(sixth).toContainText("Payée le");

    // The payment left the bank account.
    await page.goto("/fr/treasury");
    await page
      .getByTestId("treasury-accounts")
      .getByRole("link", { name: "BNA compte courant" })
      .click();
    await expect(page.getByTestId("ledger").locator('[data-source="works"]').last()).toContainText(
      "Gros œuvre Blocs A et B",
    );

    await page.goto("/ar/projects");
    await page.getByRole("link", { name: "Résidence Les Oliviers" }).first().click();
    await page.getByRole("link", { name: "التكاليف والهامش" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("التكاليف والهامش");
    await context.close();
  });
});
