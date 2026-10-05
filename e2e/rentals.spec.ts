import { expect, test } from "@playwright/test";

import { authFile, expectPdf } from "./helpers";

/** The seeded leases (src/db/seed/rentals.ts) and a new one on a free flat of Les Amandiers. */
test.describe("gestionnaire", () => {
  test.use({ storageState: authFile("propertyManager") });
  // Documents render in the background behind each other: allow for the queue.
  test.describe.configure({ timeout: 150_000 });

  test("leases a free flat, collects the deposit and the rent, records the entry", async ({
    page,
  }) => {
    await page.goto("/fr/rentals");
    const leases = page.getByTestId("leases");
    await expect(leases.locator('[data-unit="Y-00-02"]')).toContainText(
      "SARL Pharmacie El Yasmine",
    );
    await expect(leases.locator('[data-unit="D-03-03"]')).toContainText("Échéance proche");

    await page.getByRole("link", { name: "Nouveau bail" }).click();
    await page.getByRole("combobox", { name: "Lot" }).click();
    await page.getByRole("option", { name: "D-00-01 · Résidence Les Amandiers" }).click();
    await page.getByLabel("Locataire (nom ou raison sociale)").fill("Zerrouki Amine");
    await page.getByLabel("Téléphone").fill("0555 12 34 56");
    await page.getByLabel("Loyer mensuel (DA)").fill("38 000");
    await page.getByLabel("Dépôt de garantie (DA)").fill("76 000");
    await expect(page.getByTestId("lease-preview")).toContainText("et 8 autres échéances");
    await page.getByRole("button", { name: "Enregistrer le bail" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Bail BAL-\d{4}-\d{6}$/);

    // The deposit, then the first month: each with its numbered receipt.
    await page.getByRole("button", { name: "Encaisser le dépôt" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Montant (DA)").fill("76 000");
    await dialog.getByRole("button", { name: "Encaisser le dépôt" }).click();
    await expect(page.getByText(/^Paiement enregistré, reçu QIT-\d{4}-\d{6}\.$/)).toBeVisible();
    await page.getByRole("button", { name: "Encaisser un loyer" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Montant (DA)").fill("38 000");
    await dialog.getByRole("button", { name: "Encaisser un loyer" }).click();
    const payments = page.getByTestId("rent-payments");
    await expect(payments.getByRole("row")).toHaveCount(3);
    await expectPdf(page, payments.getByRole("link", { name: /^QIT-/ }).first());

    // The entry inspection, its rows prefilled with the usual rooms.
    await page.getByRole("button", { name: "État des lieux d'entrée" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("inspection-items").getByRole("listitem")).toHaveCount(8);
    await dialog.getByLabel("Clés").fill("3");
    await dialog.getByRole("button", { name: "Enregistrer l'état des lieux" }).click();
    await expectPdf(
      page,
      page.getByTestId("lease-inspections").getByRole("link", { name: /^État des lieux du/ }),
    );
  });

  test("ends the lease and settles the deposit", async ({ page }) => {
    await page.goto("/fr/rentals?status=all");
    await page
      .getByTestId("leases")
      .locator('[data-unit="D-00-01"]')
      .getByRole("link", { name: /^BAL-/ })
      .click();
    await page.getByRole("button", { name: "Terminer le bail" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Motif").fill("Départ anticipé du locataire");
    await dialog.getByRole("button", { name: "Terminer le bail" }).click();
    await expect(page.getByText("Bail terminé : le lot est disponible.")).toBeVisible();
    await expect(page.getByTestId("lease-ended")).toContainText("Départ anticipé du locataire");

    await page.getByRole("button", { name: "Solder le dépôt" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Restitué (DA)").fill("70 000");
    await dialog.getByLabel("Motif de la retenue").fill("Nettoyage");
    await dialog.getByRole("button", { name: "Solder le dépôt" }).click();
    await expect(page.getByTestId("lease-deposit")).toContainText("Soldé le");
  });

  test("follows the overdue rents", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await page.getByRole("link", { name: "Loyers impayés", exact: true }).click();
    await expect(page.getByTestId("overdue-rents")).toContainText("SARL Pharmacie El Yasmine");
  });

  test("reads the leases in Arabic, right to left", async ({ page }) => {
    await page.goto("/ar/rentals");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("عقود الإيجار");
  });
});
