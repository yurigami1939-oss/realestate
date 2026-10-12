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
    await page.getByLabel("Téléphone", { exact: true }).fill("0555 12 34 56");
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
    await page.getByRole("button", { name: "Plus d'actions" }).click();
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

  test("indexes a rent; the pharmacy's second year is already revised", async ({ page }) => {
    await page.goto("/fr/rentals");
    const leases = page.getByTestId("leases");
    await leases.locator('[data-unit="Y-00-02"]').getByRole("link").first().click();
    await expect(page.getByTestId("lease-terms")).toContainText("Loyer en vigueur");
    await expect(page.getByTestId("lease-revisions")).toContainText("Indexation annuelle de 3 %");

    await page.goto("/fr/rentals");
    await leases.locator('[data-unit="D-03-03"]').getByRole("link").first().click();
    await expect(page.getByTestId("lease-guarantor")).toContainText("Hamidi Rachid");
    await page.getByRole("button", { name: "Plus d'actions" }).click();
    await page.getByRole("button", { name: "Réviser le loyer" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Indexation (%)").fill("2");
    await expect(dialog.getByLabel("Loyer mensuel (DA)")).toHaveValue("35700,00");
    await dialog.getByLabel("Motif (indexation, accord…)").fill("Indexation convenue");
    await dialog.getByRole("button", { name: "Réviser", exact: true }).click();
    await expect(page.getByText("Loyer révisé.")).toBeVisible();
    await expect(page.getByTestId("lease-revisions")).toContainText("Indexation convenue");
  });

  test("settles a year's charges; the pharmacy's last year is already settled", async ({
    page,
  }) => {
    const year = new Date().getFullYear();
    await page.goto("/fr/rentals");
    const leases = page.getByTestId("leases");
    await leases.locator('[data-unit="Y-00-02"]').getByRole("link").first().click();
    await expect(page.getByTestId("lease-settlements")).toContainText(
      `Régularisation des charges ${year - 1}`,
    );
    await expect(page.getByTestId("rent-schedule")).toContainText(
      `Régularisation des charges ${year - 1}`,
    );

    await page.goto("/fr/rentals");
    await leases.locator('[data-unit="D-03-03"]').getByRole("link").first().click();
    await page.getByRole("button", { name: "Régulariser les charges" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Charges réelles de l'année (DA)").fill("12 000");
    await expect(dialog.getByTestId("settlement-preview")).toContainText(
      "Solde dû par le locataire",
    );
    await dialog.getByRole("button", { name: "Enregistrer la régularisation" }).click();
    await expect(page.getByText("Régularisation enregistrée.")).toBeVisible();
    await expect(page.getByTestId("lease-settlements")).toContainText("Régularisation des charges");
    await expect(page.getByTestId("rent-schedule")).toContainText("Régularisation des charges");
  });

  test("registers the family's lease at the tax office; reads the year's rental taxes", async ({
    page,
  }) => {
    // The pharmacy's lease is registered; the family's is late and waits on the dashboard.
    await page.goto("/fr/dashboard");
    await expect(page.getByTestId("dashboard-todo")).toContainText(
      /Enregistrer le bail BAL-\d{4}-\d{6} \(D-03-03\)/,
    );
    await page.goto("/fr/rentals");
    const leases = page.getByTestId("leases");
    await expect(leases.locator('[data-unit="Y-00-02"] [data-registration]')).toHaveCount(0);
    const family = leases.locator('[data-unit="D-03-03"]');
    await expect(family).toContainText("Enregistrement en retard");
    await family.getByRole("link").first().click();
    await expect(page.getByTestId("lease-registration")).toContainText("En retard");
    await page.getByRole("button", { name: "Noter l'enregistrement" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Inspection de l'enregistrement").fill("Inspection de Bab Ezzouar");
    await dialog.getByLabel("Référence d'enregistrement").fill("EN-2026-0311");
    await dialog.getByLabel("Droits payés (DA)").fill("8 400");
    await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByText("Enregistrement du bail noté.")).toBeVisible();
    await expect(page.getByTestId("lease-registration")).toContainText("EN-2026-0311");

    await page.goto("/fr/rentals");
    await page.getByRole("link", { name: "Fiscalité des loyers" }).click();
    const taxes = page.getByTestId("rent-taxes");
    await expect(taxes).toContainText("SARL Pharmacie El Yasmine");
    await expect(taxes).toContainText(/Droits : 8\s400,00\sDA/);
    await expect(page.getByTestId("rent-tax-totals")).toContainText("Commercial");
  });

  test("reports an owner's rents on a statement and pays them out", async ({ page }) => {
    // Leila Zerrouki's flat in the third party's building is let for her (management mandate).
    await page.goto("/fr/rentals");
    await expect(page.getByTestId("leases").locator('[data-unit="M-01-02"]')).toContainText(
      "pour Zerrouki Leila",
    );
    await page.getByRole("button", { name: "Plus d'actions" }).click();
    await page.getByRole("link", { name: "Propriétaires" }).click();
    await page.getByTestId("owners").getByRole("link", { name: "Zerrouki Leila" }).click();
    await expect(page.getByTestId("owner-mandates")).toContainText("M-01-02");
    await expect(page.getByTestId("owner-statements")).toContainText("Reversé");
    await expect(page.getByTestId("owner-pending")).toContainText("1 loyer encaissé à reverser");

    await page.getByRole("button", { name: "Établir un relevé" }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("statement-preview")).toContainText("Net à reverser");
    await dialog.getByRole("button", { name: "Établir un relevé" }).click();
    await expect(page.getByText(/^Relevé RDG-\d{4}-\d{6} établi\.$/)).toBeVisible();
    const issued = page
      .getByTestId("owner-statements")
      .getByRole("row")
      .filter({ hasText: "À reverser" });
    await expectPdf(page, issued.getByRole("link", { name: "Relevé (PDF)" }));

    await issued.getByRole("button", { name: "Reverser" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Référence (virement, chèque)").fill("VIR-ZERROUKI-2");
    await dialog.getByRole("button", { name: "Reverser" }).click();
    await expect(page.getByText("Reversement enregistré.")).toBeVisible();
    await expect(
      page.getByTestId("owner-statements").getByRole("row").filter({ hasText: "À reverser" }),
    ).toHaveCount(0);
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
