import { expect, type Page, test } from "@playwright/test";
import readXlsxFile from "read-excel-file/node";

import { authFile, expectPdf } from "./helpers";

/** The seeded delivered residence (src/db/seed/residences.ts), from the residences list. */
async function openResidence(page: Page, locale: "fr" | "ar" = "fr") {
  await page.goto(`/${locale}/residences`);
  await page.getByTestId("residences").getByRole("link", { name: "Résidence El Yasmine" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Résidence El Yasmine");
}

test.describe("gestionnaire", () => {
  test.use({ storageState: authFile("propertyManager") });
  // Documents render in the background behind each other: allow for the queue.
  test.describe.configure({ timeout: 150_000 });

  test("issues the next quarter's charge calls of the residence", async ({ page }) => {
    await openResidence(page);
    await expect(page.getByTestId("shares-total")).toHaveText("10000 / 10000");
    await expect(page.getByTestId("residence-units")).toContainText("Cherif Mohamed");

    await page.getByRole("link", { name: "Appels de charges" }).click();
    await page.getByRole("button", { name: "Émettre des appels" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("issue-preview")).toContainText("14 appels");
    await dialog.getByRole("button", { name: "Émettre des appels" }).click();
    await expect(page.getByText("14 appels émis.")).toBeVisible();

    // The dialog opens the new period.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^3e trimestre \d{4}$/);
    await expect(page.getByTestId("charge-calls").getByRole("row")).toHaveCount(15);
    await expect(page.getByTestId("charge-calls")).toContainText("Promoteur (lot non attribué)");
    const pdfs = page.getByTestId("charge-calls").getByRole("link", { name: /^Appel ADC-/ });
    await expectPdf(page, pdfs.first());
    // Every call gets its PDF; waiting for all of them keeps the next tests' documents unqueued.
    await expect(async () => {
      await page.reload();
      await expect(pdfs).toHaveCount(14, { timeout: 3_000 });
    }).toPass({ timeout: 120_000 });
  });

  test("agrees a repayment plan in the recovery file of an overdue unit", async ({ page }) => {
    await page.goto("/fr/residences/overdue");
    const row = page.getByTestId("overdue-charges").locator('[data-unit="Y-02-03"]');
    await expect(row.getByTestId("recovery-status")).toContainText("Lettre de relance");
    await row.getByRole("link", { name: "Y-02-03" }).click();
    const recovery = page.getByTestId("recovery");
    await expect(recovery.getByTestId("recovery-steps")).toContainText("remise en main propre");

    await recovery.getByRole("button", { name: "Échéancier d'apurement" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre de mensualités").fill("3");
    await dialog.getByRole("button", { name: "Enregistrer l'échéancier" }).click();
    await expect(page.getByText("Échéancier enregistré.")).toBeVisible();
    await expect(recovery.getByTestId("repayment-plan").getByRole("listitem")).toHaveCount(3);

    await recovery.getByRole("button", { name: "Ajouter une démarche" }).click();
    await page.getByRole("dialog").getByLabel("Remarque").fill("Accord signé au bureau");
    await page.getByRole("dialog").getByRole("button", { name: "Ajouter une démarche" }).click();
    await expect(recovery.getByTestId("recovery-steps")).toContainText("Mise en demeure");
  });

  test("calls the co-owners for works voted by the assembly", async ({ page }) => {
    await openResidence(page);
    await page.getByRole("link", { name: "Appels de charges" }).click();
    await expect(page.getByTestId("charge-periods")).toContainText(
      "Travaux d'étanchéité de la terrasse",
    );
    await page.getByRole("button", { name: "Appel de fonds travaux" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Objet de l'appel").fill("Étanchéité : second acompte");
    await dialog.getByLabel("Catégorie (clé de répartition)").click();
    await page.getByRole("option", { name: "Travaux de la terrasse" }).click();
    await dialog.getByLabel("Montant total (DA)").fill("700 000");
    await dialog.getByRole("button", { name: "Émettre des appels" }).click();
    await expect(page.getByText(/^\d+ appels émis\.$/)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Étanchéité : second acompte");
  });

  test("collects an overdue co-owner's charges against a numbered receipt", async ({ page }) => {
    await page.goto("/fr/residences/overdue");
    const overdue = page.getByTestId("overdue-charges");
    await expect(overdue).toContainText("Brahimi Omar");
    await overdue.locator('[data-unit="Y-02-03"]').getByRole("link", { name: "Y-02-03" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lot Y-02-03");
    await expect(page.getByTestId("account-reminders")).not.toBeEmpty();

    await page.getByRole("button", { name: "Enregistrer un paiement" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Versé par")).toHaveValue("Mebarki Farid");
    await dialog.getByLabel("Montant (DA)").fill("10 000");
    await dialog.getByRole("button", { name: "Enregistrer un paiement" }).click();
    await expect(page.getByText(/^Paiement enregistré, reçu RCH-\d{4}-\d{6}\.$/)).toBeVisible();
    await expectPdf(
      page,
      page.getByTestId("account-payments").getByRole("link", { name: /^RCH-\d{4}-\d{6}$/ }),
    );
  });

  test("takes charge of the lift breakdown and solves it", async ({ page }) => {
    await page.goto("/fr/tickets");
    await page
      .getByTestId("tickets")
      .getByRole("link", { name: "Ascenseur bloqué au 3e étage" })
      .click();
    await expect(page.getByTestId("ticket-events")).toContainText("Ascenseurs Hamma");
    await page.getByRole("button", { name: "Marquer résolue" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Commentaire").fill("Câble remplacé, ascenseur remis en service.");
    await dialog.getByRole("button", { name: "Marquer résolue" }).click();
    await expect(page.getByTestId("ticket-events")).toContainText("Câble remplacé");
    await expect(page.getByRole("button", { name: "Clôturer" })).toBeVisible();
  });

  test("holds a general assembly, votes by tantièmes and gets its PV", async ({ page }) => {
    await openResidence(page);
    await page.getByRole("link", { name: "Assemblées générales" }).click();
    // The seeded ordinary assembly is closed with its results.
    await expect(page.getByTestId("assemblies")).toContainText("3 résolutions adoptées sur 4");

    await page.getByRole("button", { name: "Nouvelle assemblée" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Lieu").fill("Hall du bloc Y");
    await dialog.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /^Assemblée générale ordinaire du \d{2}\/\d{2}\/\d{4}$/,
    );

    await page.getByRole("button", { name: "Ajouter une résolution" }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Intitulé", { exact: true })
      .fill("Changement du prestataire de nettoyage");
    await dialog.getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByTestId("agenda")).toContainText("Changement du prestataire");

    await page.getByRole("button", { name: "Convoquer" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Convoquer" }).click();
    await expect(page.getByText("Convoquée", { exact: true })).toBeVisible();
    await expectPdf(page, page.getByRole("link", { name: "Convocation (PDF)" }));

    // Two co-owners come, a third is represented.
    const sheet = page.getByTestId("attendance-sheet");
    await sheet
      .getByRole("radiogroup", { name: "Présence du lot Y-01-01" })
      .getByRole("radio", { name: "Présent", exact: true })
      .click();
    await sheet
      .getByRole("radiogroup", { name: "Présence du lot Y-02-01" })
      .getByRole("radio", { name: "Présent", exact: true })
      .click();
    await sheet
      .getByRole("radiogroup", { name: "Présence du lot Y-03-02" })
      .getByRole("radio", { name: "Représenté", exact: true })
      .click();
    await sheet.getByLabel("Mandataire du lot Y-03-02").fill("Zitouni Karim");
    await expect(page.getByTestId("attendance-summary")).toContainText("3 sur 14 lots");
    await page.getByRole("button", { name: "Enregistrer la feuille de présence" }).click();
    await expect(page.getByText("Feuille de présence enregistrée.")).toBeVisible();

    await page.getByRole("button", { name: "Tous pour la résolution 1" }).click();
    await page.getByRole("button", { name: /^Lot Y-03-02, résolution 1/ }).click();
    await expect(page.getByTestId("result-1")).toContainText("Adoptée");
    await page.getByRole("button", { name: "Enregistrer les votes" }).click();
    await expect(page.getByText("Votes enregistrés.")).toBeVisible();

    await page.getByRole("button", { name: "Clôturer" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Président de séance").fill("Hadjadj Lamia");
    await dialog.getByLabel("Secrétaire de séance").fill("Rachid Ouali");
    await dialog.getByRole("button", { name: "Clôturer et générer le PV" }).click();
    await expect(page.getByText("Clôturée", { exact: true })).toBeVisible();
    await expect(page.getByTestId("agenda")).toContainText("Adoptée");
    await expectPdf(page, page.getByRole("link", { name: "Procès-verbal (PDF)" }));
  });

  test("publishes an announcement with its notice to post", async ({ page }) => {
    await openResidence(page);
    await page.getByRole("link", { name: "Annonces" }).click();
    const list = page.getByTestId("announcements");
    await expect(list.locator('[data-state="published"]').first()).toContainText(
      "Assemblée générale extraordinaire",
    );

    await page.getByRole("button", { name: "Nouvelle annonce" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Titre", { exact: true }).fill("Entretien de l'ascenseur");
    await dialog
      .getByLabel("Texte", { exact: true })
      .fill("L'ascenseur sera à l'arrêt mardi matin.");
    await dialog.getByRole("button", { name: "Créer" }).click();
    const draft = list.locator("li").filter({ hasText: "Entretien de l'ascenseur" });
    await expect(draft).toHaveAttribute("data-state", "draft");

    await draft.getByRole("button", { name: "Publier" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Publier" }).click();
    await expect(draft).toHaveAttribute("data-state", "published");
    await expectPdf(page, draft.getByRole("link", { name: "Avis à afficher (PDF)" }));
  });

  test("keeps the scan of a supplier invoice", async ({ page }) => {
    await openResidence(page);
    await page.getByRole("link", { name: "Dépenses" }).click();
    const invoice = page
      .getByTestId("invoices")
      .getByRole("row")
      .filter({ hasText: "Maintenance du trimestre" })
      .first();
    await invoice.getByTestId("upload-supplier_invoice.scan").setInputFiles({
      name: "facture.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nfacture\n%%EOF"),
    });
    await expect(page.getByText("Scan enregistré.")).toBeVisible();
    await expectPdf(page, invoice.getByRole("link", { name: "Scan", exact: true }));
  });

  test("follows the inspections: the extinguishers checked, their certificate kept", async ({
    page,
  }) => {
    await page.goto("/fr/dashboard");
    await expect(page.getByTestId("dashboard-todo")).toContainText(
      "Vérification des extincteurs (Résidence El Yasmine) : échéance dépassée",
    );
    await page.getByRole("link", { name: /^Vérification des extincteurs/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Résidence El Yasmine");
    const checks = page.getByTestId("residence-checks");
    const extinguishers = checks.locator('[data-check="Vérification des extincteurs"]');
    await expect(extinguishers).toHaveAttribute("data-state", "overdue");
    await expect(
      checks.locator(`[data-check="Contrôle périodique de l'ascenseur"]`),
    ).toHaveAttribute("data-state", "due_soon");

    await extinguishers.getByRole("button", { name: "Visite effectuée" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Coût (DA)").fill("12 000");
    await dialog.getByRole("button", { name: "Visite effectuée" }).click();
    await expect(
      page.getByText("Visite enregistrée, prochaine échéance mise à jour."),
    ).toBeVisible();
    await expect(extinguishers).toHaveAttribute("data-state", "ok");

    const visit = extinguishers.getByTestId("check-visits").getByRole("listitem").first();
    await visit.getByTestId("upload-residence_check.scan").setInputFiles({
      name: "attestation.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nattestation\n%%EOF"),
    });
    await expect(page.getByText("Attestation enregistrée.")).toBeVisible();
    await expectPdf(page, visit.getByRole("link", { name: "Attestation", exact: true }));
  });

  test("downloads the year's accounts for the general assembly", async ({ page }) => {
    await openResidence(page);
    await page.getByRole("link", { name: "Bilan", exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-assembly_pack").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^ag-comptes-.+-\d{4}\.xlsx$/);
    const sheets = await readXlsxFile((await download.path()) ?? "");
    expect(sheets.map((s) => s.sheet).slice(0, 2)).toEqual([
      "Budget et réalisé",
      "Fonds de réserve",
    ]);
  });

  test("reads the residence in Arabic, right to left", async ({ page }) => {
    await openResidence(page, "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByRole("link", { name: "الجمعيات العامة" }).click();
    await expect(page.getByTestId("assemblies")).toContainText("مختتمة");
  });
});
