import { expect, test } from "@playwright/test";

import { authFile, expectPdf } from "./helpers";

/** The demo resident account (Mohamed Cherif), linked by the seed (src/db/seed/portal.ts). */
test.describe("acquéreur et copropriétaire", () => {
  test.use({ storageState: authFile("resident") });
  // Documents render in the background behind each other: allow for the queue.
  test.describe.configure({ timeout: 150_000 });

  test("follows their purchase, its schedule and its documents", async ({ page }) => {
    // Portal accounts never see the back office.
    await page.goto("/fr/dashboard");
    await expect(page).toHaveURL(/\/fr\/portal$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bonjour Mohamed Cherif");

    await page
      .getByTestId("portal-sales")
      .getByRole("link", { name: "Résidence Les Oliviers · B-02-02" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Résidence Les Oliviers · B-02-02",
    );
    await expect(page.getByTestId("portal-schedule").getByRole("row").nth(1)).toBeVisible();
    await expect(page.getByTestId("portal-payments")).toContainText("Virement");
    await expect(page.getByTestId("portal-progress")).toBeVisible();
    // Construction reports: the published ones only, with their site photos.
    const reports = page.getByTestId("portal-reports");
    await expect(reports).toContainText("Gros œuvre achevé");
    await expect(reports).not.toContainText("Réunion de chantier");
    await expect(reports.getByRole("img").first()).toBeVisible();
    // The seeded transfer: the oldest payment (other specs pay online on this sale too).
    await expectPdf(
      page,
      page
        .getByTestId("portal-payments")
        .getByRole("link", { name: /^Reçu REC-/ })
        .last(),
    );
    await expectPdf(
      page,
      page.getByTestId("portal-documents").getByRole("link", { name: "Fiche de réservation" }),
    );
  });

  test("sends a piece of their buyer file from the portal", async ({ page }) => {
    await page.goto("/fr/portal");
    await page.getByRole("link", { name: "Mon dossier" }).click();
    const file = page.getByTestId("portal-buyer-file");
    const payslips = file.locator('[data-kind="payslips"]');
    await expect(payslips).toContainText("Manquante");
    await page.getByTestId("upload-portal.buyer_document-payslips").setInputFiles({
      name: "fiches-de-paie.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7 scan %%EOF"),
    });
    await expect(page.getByText("Pièce envoyée ; le promoteur va la vérifier.")).toBeVisible();
    await expect(payslips).toContainText("Envoyée · en vérification");
  });

  test("asks the promoter for an attestation, which the cashier answers", async ({
    page,
    browser,
  }) => {
    await page.goto("/fr/portal");
    await page
      .getByTestId("portal-sales")
      .getByRole("link", { name: "Résidence Les Oliviers · B-02-02" })
      .click();
    await page.getByRole("button", { name: "Faire une demande" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Message").fill("Pour mon dossier de prêt à la CNEP");
    await dialog.getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByText("Demande envoyée au promoteur.")).toBeVisible();
    await expect(page.getByTestId("portal-requests")).toContainText("En attente");

    const desk = await browser.newContext({ storageState: authFile("cashier") });
    const cashier = await desk.newPage();
    await cashier.goto("/fr/sales/requests");
    const row = cashier
      .getByTestId("portal-requests")
      .getByRole("row")
      .filter({ hasText: "Cherif" });
    await expect(row).toContainText("Attestation de versements");
    await row.getByRole("button", { name: "Répondre" }).click();
    await cashier.getByRole("dialog").getByLabel("Réponse au client").fill("Prête à l'accueil.");
    await cashier.getByRole("dialog").getByRole("button", { name: "Traitée" }).click();
    await expect(cashier.getByText("Demande traitée.")).toBeVisible();
    await desk.close();

    await page.reload();
    await expect(page.getByTestId("portal-requests")).toContainText("Réponse : Prête à l'accueil.");
  });

  test("follows their charges, announcements, tickets and assemblies", async ({
    page,
    browser,
  }) => {
    await page.goto("/fr/portal");
    await page
      .getByTestId("portal-units")
      .getByRole("link", { name: "Résidence El Yasmine · Y-01-01" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Résidence El Yasmine · Y-01-01",
    );
    // Both quarters called so far are paid; the terrace works voted in assembly are called.
    await expect(page.getByTestId("portal-calls").getByRole("row")).toHaveCount(4);
    await expect(page.getByTestId("portal-calls")).toContainText(
      "Travaux d'étanchéité de la terrasse",
    );
    await expect(page.getByTestId("portal-calls")).not.toContainText("En retard");

    await page.getByRole("link", { name: "Annonces" }).click();
    await expect(
      page.getByTestId("portal-announcements").getByRole("listitem").first(),
    ).toContainText("Assemblée générale extraordinaire");

    await page.getByRole("link", { name: "Réclamations" }).click();
    await page.getByRole("button", { name: "Signaler un problème" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Objet").fill("Interphone en panne");
    await dialog.getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Interphone en panne");
    await expect(page.getByTestId("portal-ticket-events")).toContainText("Réclamation ouverte");

    // The gestionnaire receives it, signed by the resident.
    const staff = await browser.newContext({ storageState: authFile("propertyManager") });
    const manager = await staff.newPage();
    await manager.goto("/fr/tickets");
    await manager.getByTestId("tickets").getByRole("link", { name: "Interphone en panne" }).click();
    await expect(manager.getByText("Cherif Mohamed")).toBeVisible();
    await staff.close();

    await page.getByRole("link", { name: "Assemblées" }).click();
    const assemblies = page.getByTestId("portal-assemblies");
    await expect(assemblies).toContainText("Assemblée générale ordinaire");
    await expectPdf(page, assemblies.getByRole("link", { name: "Procès-verbal (PDF)" }));
  });

  test("reads the portal in Arabic, right to left", async ({ page }) => {
    await page.goto("/ar/portal");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("مرحباً Mohamed Cherif");
    await expect(page.getByRole("link", { name: "الإعلانات" })).toBeVisible();
  });
});
