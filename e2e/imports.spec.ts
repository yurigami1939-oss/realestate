import { expect, test } from "@playwright/test";
import writeXlsxFile from "write-excel-file/node";

import { authFile } from "./helpers";

/** An .xlsx of text cells, as a promoter's own spreadsheet would be. */
async function spreadsheet(sheet: string, rows: string[][]) {
  return writeXlsxFile(
    [{ sheet, data: rows.map((row) => row.map((value) => ({ value, type: String }))) }],
    {},
  ).toBuffer();
}

/** Data import (reprise): the gérant brings in buyer files from Excel. */
test.describe("data import", () => {
  test.use({ storageState: authFile("owner") });

  test("the gérant checks a file, fixes it, then imports the buyers", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await page.getByRole("link", { name: "Reprise de données" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reprise de données");
    const panel = page.getByTestId("import-buyers");
    await expect(panel.getByRole("link", { name: "Télécharger le modèle" })).toHaveAttribute(
      "href",
      "/api/imports/buyers/template?locale=fr",
    );

    const headers = ["Civilité", "Nom", "Prénom", "NIN", "Téléphone"];
    // A wrong civility and a missing phone: nothing can be imported yet.
    await panel.getByLabel("Fichier Excel (.xlsx)").setInputFiles({
      name: "acquereurs.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await spreadsheet("Acquéreurs", [
        headers,
        ["Dr", "Reprise", "Ali", "", "0661 98 76 01"],
        ["M.", "Reprise", "Omar", "", ""],
      ]),
    });
    await panel.getByRole("button", { name: "Vérifier" }).click();
    const issues = panel.getByTestId("import-issues");
    await expect(issues).toContainText("Valeur non reconnue : « Dr ».");
    await expect(panel.getByText("2 problèmes à corriger avant d'importer")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Importer" })).toHaveCount(0);

    await panel.getByLabel("Fichier Excel (.xlsx)").setInputFiles({
      name: "acquereurs.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await spreadsheet("Acquéreurs", [
        headers,
        ["M.", "Reprise", "Ali", "", "0661 98 76 01"],
        ["M.", "Reprise", "Omar", "", "0661 98 76 02"],
      ]),
    });
    await panel.getByRole("button", { name: "Vérifier" }).click();
    await expect(panel.getByText("Prêt à importer")).toBeVisible();
    await expect(panel.getByText("2 acquéreurs")).toBeVisible();
    await panel.getByRole("button", { name: "Importer" }).click();
    await expect(panel.getByText("Importé", { exact: true })).toBeVisible();

    await page.goto("/fr/buyers?q=Reprise");
    await expect(page.getByRole("link", { name: /Reprise Ali/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Reprise Omar/ })).toBeVisible();
  });

  test("the Arabic page reads right to left", async ({ page }) => {
    await page.goto("/ar/imports");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("استرجاع البيانات");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("import-sales")).toBeVisible();
  });
});
