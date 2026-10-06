import { expect, test } from "@playwright/test";

import { authFile } from "./helpers";

/** Agencies and introducers (src/db/seed/crm.ts: El Bahia and Hocine Merabet). */
test.describe("directrice commerciale", () => {
  test.use({ storageState: authFile("salesManager") });

  test("adds an agency and names it on a lead", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await page.getByRole("link", { name: "Agences et apporteurs" }).click();
    const partners = page.getByTestId("partners");
    await expect(partners).toContainText("Agence immobilière El Bahia");

    await page.getByRole("button", { name: "Nouveau partenaire" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nom", { exact: true }).fill("Immo Hydra");
    await dialog.getByLabel("Commission (% du prix net)").fill("2");
    await dialog.getByRole("button", { name: "Nouveau partenaire" }).click();
    await expect(page.getByText("Partenaire créé.")).toBeVisible();
    await expect(partners.locator('[data-partner="Immo Hydra"]')).toContainText("2");

    await page.goto("/fr/leads/new");
    await page.getByLabel("Nom complet").fill("Lamia Rahal");
    await page.getByLabel("Téléphone", { exact: true }).fill("0770 55 66 77");
    await page.getByRole("combobox", { name: "Apporté par" }).click();
    await page.getByRole("option", { name: "Immo Hydra" }).click();
    await page.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lamia Rahal");
    await expect(page.locator("main")).toContainText("Immo Hydra");
  });
});
