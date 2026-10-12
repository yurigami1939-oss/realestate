import { expect, type Page, test } from "@playwright/test";

import { authFile } from "./helpers";

/** Opens a lead from the list, searching by name. */
async function openLead(page: Page, name: string) {
  await page.goto(`/fr/leads?q=${encodeURIComponent(name)}`);
  await page.getByTestId("leads-table").getByRole("link", { name, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
}

const stageBadge = (page: Page) => page.getByRole("heading", { level: 1 }).locator("..");

test.describe("commercial", () => {
  test.use({ storageState: authFile("salesAgent") });

  test("works a lead from first call to a quotation PDF", async ({ page }) => {
    // New lead with a phone already on one of the commercial's leads: allowed, flagged.
    await page.goto("/fr/leads/new");
    await page.getByLabel("Nom complet").fill("Samia Haddad");
    await page.getByLabel("Téléphone", { exact: true }).fill("0661 23 45 67");
    await page.getByRole("combobox", { name: "Projet souhaité" }).click();
    await page.getByRole("option", { name: "Résidence Les Oliviers" }).click();
    await page.getByRole("button", { name: "Créer" }).click();
    await expect(
      page.getByText("Prospect créé. Ce numéro existe déjà sur 1 autre fiche."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Samia Haddad");
    await expect(page.getByTestId("lead-duplicates")).toContainText(
      "Ce numéro figure sur 1 autre fiche.",
    );
    await expect(stageBadge(page)).toContainText("Nouveau");

    // Call planned, then done: the lead counts as contacted.
    const followUps = page.getByTestId("lead-follow-ups");
    await followUps.getByRole("button", { name: "Planifier une relance" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Créer" }).click();
    await expect(page.getByText("Relance planifiée.")).toBeVisible();
    await followUps.getByRole("button", { name: "Fait" }).click();
    await page.getByRole("dialog").getByLabel("Résultat").fill("Intéressée par un F3 exposé sud");
    await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
    await expect(followUps).toContainText("Intéressée par un F3 exposé sud");
    await expect(stageBadge(page)).toContainText("Contacté");

    // Visit planned, then recorded as done.
    const visits = page.getByTestId("lead-visits");
    await visits.getByRole("button", { name: "Planifier une visite" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Créer" }).click();
    await expect(stageBadge(page)).toContainText("Visite planifiée");
    await visits.getByRole("button", { name: "Compte rendu" }).click();
    await page.getByRole("dialog").getByLabel("Compte rendu").fill("A visité l'appartement témoin");
    await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
    await expect(visits).toContainText("Effectuée");
    await expect(stageBadge(page)).toContainText("Visité");

    // Quotation: unit + default plan; commercials get no discount field.
    await page.getByRole("link", { name: "Nouveau devis" }).click();
    await expect(page.getByLabel("Remise (DA)")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Lot" }).click();
    await page.getByRole("option", { name: /^A-06-02 · F3/ }).click();
    await expect(page.getByTestId("quotation-schedule").getByRole("row")).toHaveCount(6);
    // The buyer's costs estimated with the company's figures (seeded as an example).
    await expect(page.getByTestId("acquisition-costs")).toContainText("Honoraires du notaire");
    await page.getByRole("button", { name: "Émettre le devis" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Devis DEV-\d{4}-\d{6}$/);
    await expect(page.getByTestId("quotation-lines").getByRole("row")).toHaveCount(6);
    await expect(page.getByTestId("acquisition-costs")).toContainText("Coût total estimé");

    // The worker renders the PDF; the page refreshes until the link appears.
    const download = page.getByRole("link", { name: "Télécharger le PDF" });
    await expect(download).toBeVisible({ timeout: 30_000 });
    const pdf = await page.request.get((await download.getAttribute("href")) ?? "");
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    await page
      .getByRole("navigation", { name: "Fil d'Ariane" })
      .getByRole("link", { name: "Samia Haddad" })
      .click();
    await expect(stageBadge(page)).toContainText("Négociation");
    await expect(page.getByTestId("lead-quotations")).toContainText("A-06-02");
  });

  test("sees only their own leads and follow-ups", async ({ page }) => {
    await page.goto("/fr/leads");
    await expect(page.getByTestId("leads-table")).toContainText("Samir Haddad");
    await expect(page.getByTestId("leads-table")).not.toContainText("Imane Rahmani");
    await expect(page.getByRole("link", { name: "Doublons" })).toHaveCount(0);
    await page.goto("/fr/follow-ups");
    await expect(page.getByTestId("follow-ups-overdue")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Imane Rahmani");
  });
});

test.describe("directrice commerciale", () => {
  test.use({ storageState: authFile("salesManager") });

  test("merges duplicates, discounts and cancels a quotation", async ({ page }) => {
    await page.goto("/fr/leads/duplicates");
    const group = page.getByTestId("duplicate-group").filter({ hasText: "Amina K." });
    await group
      .getByRole("listitem")
      .filter({ hasText: "Amina Kaci" })
      .getByRole("button", { name: "Conserver" })
      .click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Conserver" }).click();
    await expect(page.getByText("Fiches fusionnées.")).toBeVisible();
    await expect(page.getByTestId("duplicate-group").filter({ hasText: "Amina K." })).toHaveCount(
      0,
    );

    await openLead(page, "Amina Kaci");
    await expect(page.getByTestId("lead-timeline")).toContainText(
      "Fiche « Amina K. » fusionnée ici",
    );

    await page.getByRole("link", { name: "Nouveau devis" }).click();
    await page.getByRole("combobox", { name: "Lot" }).click();
    await page.getByRole("option", { name: /^A-07-01 · F2/ }).click();
    await page.getByLabel("Remise (DA)").fill("300 000");
    await page.getByRole("button", { name: "Émettre le devis" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Devis DEV-/);
    await expect(page.locator("main")).toContainText("Remise");

    await page.getByRole("button", { name: "Annuler le devis" }).click();
    await page.getByRole("dialog").getByLabel("Motif").fill("Le client préfère un F3");
    await page.getByRole("dialog").getByRole("button", { name: "Annuler le devis" }).click();
    await expect(page.getByText("Devis annulé.")).toBeVisible();
    await expect(page.locator("main")).toContainText("Le client préfère un F3");
  });

  test("exports a prospect's data, then erases them at their request", async ({ page }) => {
    await page.goto("/fr/leads?q=Farida");
    await page.getByRole("link", { name: "Farida Laïb" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Farida Laïb");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-person").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^donnees-.+-loi-18-07\.xlsx$/);

    await page.getByRole("button", { name: "Plus d'actions" }).click();
    await page.getByRole("button", { name: "Anonymiser" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Motif (demande de la personne, durée de conservation dépassée…)")
      .fill("Demande reçue par courriel");
    await dialog.getByRole("button", { name: "Anonymiser" }).click();
    await expect(page.getByText("Prospect anonymisé.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Prospect anonymisé");
    await expect(page.getByRole("button", { name: "Anonymiser" })).toHaveCount(0);
  });

  test("sets monthly targets", async ({ page }) => {
    await page.goto("/fr/targets");
    await page.getByLabel("Visites effectuées Yacine Belkacem").fill("15");
    await page.getByRole("button", { name: "Enregistrer les objectifs" }).click();
    await expect(page.getByText("Objectifs enregistrés.")).toBeVisible();
    await page.reload();
    await expect(
      page.getByTestId("targets").getByRole("row", { name: /Yacine Belkacem/ }),
    ).toContainText("/ 15");
  });
});

test.describe("gérant", () => {
  test.use({ storageState: authFile("owner") });

  test("keeps the retention periods and the register of processing", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await page.getByRole("link", { name: "Réglages" }).click();
    await page.getByRole("link", { name: "Données personnelles" }).click();
    await expect(page.getByLabel("Prospects sans achat (mois sans activité)")).toHaveValue("36");
    const register = page.getByTestId("processing-register");
    await expect(register.locator('[data-activity="prospects"]')).toContainText(
      "Appliquée automatiquement : 36 mois.",
    );
    await expect(register.locator('[data-activity="sales"]')).toContainText("Exécution du contrat");
    await page.getByLabel("Journaux WhatsApp et SMS (mois)").fill("12");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Durées de conservation enregistrées.")).toBeVisible();
    await expect(register.locator('[data-activity="notifications"]')).toContainText(
      "Appliquée automatiquement : 12 mois.",
    );
    await page.goto("/ar/settings/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("المعطيات الشخصية");
  });

  test("sets the company's wording on its receipts", async ({ page }) => {
    await page.goto("/fr/settings/documents");
    const receipts = page.getByLabel("Reçus et quittances — en français");
    await receipts.fill("Caisse ouverte du dimanche au jeudi, de 8 h à 15 h.");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Textes des documents enregistrés.")).toBeVisible();
    await page.reload();
    await expect(receipts).toHaveValue("Caisse ouverte du dimanche au jeudi, de 8 h à 15 h.");
  });

  test("defines a custom role and gives it to a commercial, then takes it back", async ({
    page,
  }) => {
    await page.goto("/fr/settings/roles");
    await page.getByRole("button", { name: "Nouveau rôle" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nom du rôle").fill("Assistante commerciale");
    // Prefilled with the commercial's rights; every lead added.
    await expect(dialog.getByRole("checkbox", { name: "Prospects · Consulter" })).toBeChecked();
    await dialog.getByRole("checkbox", { name: "Prospects · Tout consulter" }).check();
    await dialog.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByText("Rôle créé.")).toBeVisible();
    const card = page.getByTestId("custom-roles").locator('[data-role="Assistante commerciale"]');
    await expect(card).toContainText("Prospects · Tout consulter");

    await page.goto("/fr/settings/members");
    const menu = () => page.getByRole("button", { name: "Actions pour Lina Saadi" }).click();
    await menu();
    await page.getByRole("menuitemradio", { name: "Assistante commerciale" }).click();
    await expect(page.getByText("Rôles mis à jour.").first()).toBeVisible();
    const row = page
      .getByTestId("members-table")
      .getByRole("row")
      .filter({ hasText: "Lina Saadi" });
    await expect(row).toContainText("Assistante commerciale");
    await menu();
    await page.getByRole("menuitemradio", { name: "Aucun (rôles ci-dessus)" }).click();
    await expect(row).toContainText("Commercial");
    await expect(row).not.toContainText("Assistante commerciale");
  });

  test("records a buyer's consent to commercial offers and sees who read the file", async ({
    page,
  }) => {
    await page.goto("/fr/buyers?q=Lounis");
    await page.getByRole("link", { name: /Lounis Assia/ }).click();
    const privacy = page.getByTestId("person-privacy");
    await expect(privacy).toContainText("Consultations du dossier");
    await expect(privacy.getByTestId("person-accesses")).toContainText(/\d+ fois/);
    await page.getByRole("link", { name: "Modifier" }).click();
    await page.getByLabel("Accepte de recevoir des offres commerciales (autres projets)").check();
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByTestId("person-consents")).toContainText(
      "Offres commerciales : consentement donné",
    );
  });
});
