import { expect, type Page, test } from "@playwright/test";

import { authFile } from "./helpers";

async function openLead(page: Page, name: string) {
  await page.goto(`/fr/leads?q=${encodeURIComponent(name)}`);
  await page.getByTestId("leads-table").getByRole("link", { name, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
}

test.describe("commercial", () => {
  test.use({ storageState: authFile("salesAgent") });

  test("grants the discount approved for a lead and asks for another one", async ({ page }) => {
    // Seeded: 500 000 DA asked for Samir Haddad on A-04-02, granted at 300 000 DA.
    await openLead(page, "Samir Haddad");
    const discounts = page.getByTestId("lead-discounts");
    await expect(discounts).toContainText("Accordée : 300 000,00 DA jusqu'au");
    await expect(page.getByTestId("lead-timeline")).toContainText(
      "Remise de 300 000,00 DA accordée sur le lot A-04-02",
    );

    await page.getByRole("link", { name: "Nouveau devis" }).click();
    await page.getByRole("combobox", { name: "Lot" }).click();
    await page.getByRole("option", { name: /^A-04-02 / }).click();
    await expect(
      page.getByText("Remise accordée sur ce lot : jusqu'à 300 000,00 DA."),
    ).toBeVisible();
    await page.getByLabel("Remise (DA)").fill("400 000");
    await expect(
      page.getByText("La remise dépasse celle accordée par la direction."),
    ).toBeVisible();
    await page.getByLabel("Remise (DA)").fill("300 000");
    await page.getByRole("button", { name: "Émettre le devis" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Devis DEV-/);
    await expect(page.locator("main")).toContainText("300 000,00 DA");

    // A new request on another unit, sent to the directrice commerciale.
    await openLead(page, "Samir Haddad");
    await discounts.getByRole("button", { name: "Demander une remise" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Lot" }).click();
    await page.getByRole("option", { name: /^A-05-03 / }).click();
    await dialog.getByLabel("Remise demandée (DA)").fill("200 000");
    await dialog.getByLabel(/^Motif/).fill("Deuxième achat de la famille");
    await dialog.getByRole("button", { name: "Demander une remise" }).click();
    await expect(page.getByText("Demande envoyée à la direction commerciale.")).toBeVisible();
    await expect(discounts.getByRole("listitem").filter({ hasText: "A-05-03" })).toContainText(
      "En attente",
    );
  });
});

test.describe("directrice commerciale", () => {
  test.use({ storageState: authFile("salesManager") });

  test("decides the discounts asked for from the dashboard", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await page
      .getByTestId("dashboard-todo")
      .getByRole("link", { name: /demandes? de remise à décider/ })
      .click();
    await expect(page).toHaveURL(/\/fr\/sales\/discounts/);
    const table = page.getByTestId("discount-requests");
    const amina = table.getByRole("row").filter({ hasText: "Amina Kaci" });
    await expect(amina).toContainText("Paiement de 50 % à la réservation");

    // Granted for less than asked.
    await amina.getByRole("button", { name: "Décider" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Remise accordée (DA)").fill("350 000");
    await dialog.getByRole("button", { name: "Accorder" }).click();
    await expect(page.getByText("Remise accordée.", { exact: true })).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "Amina Kaci" })).toHaveCount(0);

    await page.getByRole("combobox", { name: "État" }).click();
    await page.getByRole("option", { name: "Accordée", exact: true }).click();
    await expect(table.getByRole("row").filter({ hasText: "Amina Kaci" })).toContainText(
      "Accordée : 350 000,00 DA",
    );
  });
});
