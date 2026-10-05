import { expect, test } from "@playwright/test";

import { authFile } from "./helpers";

/**
 * The promoter's obligations (Loi 11-04): the regulatory files seeded for Les Oliviers and La
 * Corniche (src/db/seed/obligations.ts), and « Résidence Les Amandiers », whose contracts promised
 * the keys three weeks ago (src/db/seed/deliveries.ts).
 */
test.describe("promoter's obligations", () => {
  test.use({ storageState: authFile("owner") });

  test("the gérant completes a project's regulatory file from the dashboard", async ({ page }) => {
    await page.goto("/fr/dashboard");
    const todo = page.getByTestId("dashboard-todo");
    await expect(todo).toContainText("1 document administratif expiré ou à renouveler");
    await expect(todo).toContainText(/\d+ projets? au dossier administratif incomplet/);
    await expect(todo).toContainText(/\d+ livraisons? en retard sur la date contractuelle/);

    await page.goto("/fr/projects");
    await page.getByRole("link", { name: "Les Terrasses de la Corniche" }).first().click();
    const file = page.getByTestId("project-documents");
    await expect(file.getByTestId("project-documents-checklist")).toContainText(
      "Affiliation au FGCMPI : manquant",
    );
    await file.getByRole("button", { name: "Ajouter un document" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Document", { exact: true }).click();
    await page.getByRole("option", { name: "Affiliation au FGCMPI" }).click();
    await dialog.getByLabel("Référence / numéro").fill("FGCMPI-16-0482");
    await dialog.getByLabel("Délivré le").fill("2025-01-15");
    await dialog.getByRole("button", { name: "Ajouter un document" }).click();
    await expect(page.getByText("Document ajouté.")).toBeVisible();
    const fgcmpi = file.locator('[data-kind="fgcmpi"]');
    await expect(fgcmpi).toContainText("FGCMPI-16-0482");
    await expect(file.getByTestId("project-documents-checklist")).not.toContainText(
      "Affiliation au FGCMPI : manquant",
    );

    await fgcmpi.getByTestId("upload-project_document.scan").setInputFiles({
      name: "affiliation.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\naffiliation\n%%EOF"),
    });
    await expect(fgcmpi.getByRole("link", { name: "Voir le scan" })).toBeVisible();

    // Les Oliviers: the insurance is to renew this month.
    await page.goto("/fr/projects");
    await page.getByRole("link", { name: "Résidence Les Oliviers" }).first().click();
    await expect(page.locator('[data-kind="insurance"]')).toContainText("À renouveler");
  });

  test("a late delivery shows the indemnity owed and the missing guarantee", async ({ page }) => {
    await page.goto("/fr/sales?q=Mansouri");
    await page.getByTestId("sales-table").getByRole("link", { name: /^RES-/ }).first().click();
    const card = page.getByTestId("sale-obligations");
    await expect(card).toContainText("Retard de livraison");
    await expect(card).toContainText("Indemnité due (indicative)");
    await expect(card).toContainText("Attestation de garantie non enregistrée");

    await page.goto("/fr/deliveries?state=all");
    await expect(page.getByTestId("delivery-late").first()).toContainText(/En retard de \d+ jours/);
  });

  test("reads the regulatory file in Arabic", async ({ page }) => {
    await page.goto("/ar/projects");
    await page.getByRole("link", { name: "Résidence Les Oliviers" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("project-documents")).toContainText("الملف الإداري");
  });
});
