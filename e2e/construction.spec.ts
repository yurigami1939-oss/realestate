import { expect, test } from "@playwright/test";

import { authFile, PNG } from "./helpers";

/** The seeded progress reports (src/db/seed/construction.ts). */
test.describe("responsable technique", () => {
  test.use({ storageState: authFile("technicalManager") });

  test("reports the progress of the works with a site photo", async ({ page }) => {
    // No sales, no money: the works and the deliveries only.
    await page.goto("/fr/dashboard");
    await expect(page.getByRole("link", { name: "Réservations et ventes" })).toHaveCount(0);
    await page.getByRole("link", { name: "Avancement des travaux" }).click();

    const projects = page.getByTestId("construction-projects");
    await expect(projects.locator('[data-project="OLIV"]')).toContainText("64 %");
    await projects.getByRole("link", { name: "Résidence Les Oliviers" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Résidence Les Oliviers");
    // The internal report stays in the back office.
    await expect(page.locator('[data-report="Réunion de chantier : menuiseries"]')).toContainText(
      "Interne",
    );

    await page.getByRole("button", { name: "Nouveau compte rendu" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Titre", { exact: true }).fill("Étanchéité des terrasses");
    await dialog
      .getByLabel("Texte", { exact: true })
      .fill("Pose de l'étanchéité sur les terrasses des deux blocs.");
    // Prefilled with the current progress.
    await expect(dialog.getByLabel("Bloc A (%)")).toHaveValue("64");
    await dialog.getByLabel("Bloc A (%)").fill("70");
    await dialog.getByLabel("Bloc B (%)").fill("61");
    await dialog.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByText("Compte rendu enregistré.")).toBeVisible();

    const report = page.locator('[data-report="Étanchéité des terrasses"]');
    await expect(report).toContainText("Visible sur l'espace client");
    await expect(page.getByTestId("building-progress")).toContainText("70 %");
    await report
      .getByTestId("upload-construction_report.photo")
      .setInputFiles({ name: "terrasse.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("Photo ajoutée.")).toBeVisible();
    await expect(report.getByTestId("report-photos").getByRole("img")).toHaveCount(1);
  });

  test("reads the construction follow-up in Arabic, right to left", async ({ page }) => {
    await page.goto("/ar/construction");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("تقدم الأشغال");
    await expect(page.getByTestId("construction-projects")).toContainText(
      "Résidence Les Amandiers",
    );
  });
});
