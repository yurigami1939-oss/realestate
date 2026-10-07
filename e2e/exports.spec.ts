import { expect, test } from "@playwright/test";
import readXlsxFile from "read-excel-file/node";

import { authFile } from "./helpers";

/** Spreadsheet exports, read back as the accountant's Excel would. */
test.describe("exports Excel", () => {
  test.use({ storageState: authFile("cashier") });

  test("the cashier downloads the journal of collections and the sales", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await page.getByRole("link", { name: "Exports Excel" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Exports Excel");

    // The journal over the last two years: the seeded payments are in it.
    await page.getByLabel("Du", { exact: true }).fill("2024-01-01");
    const [journal] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-collections").click(),
    ]);
    expect(journal.suggestedFilename()).toMatch(
      /^encaissements-2024-01-01_\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    const [entries, summary] = await readXlsxFile((await journal.path()) ?? "");
    expect(entries?.data[0]).toContain("N° de reçu");
    expect(entries?.data.length).toBeGreaterThan(10);
    expect(entries?.data.slice(1).every((row) => typeof row[8] === "number")).toBe(true);
    expect(summary?.data.at(-1)?.[0]).toBe("Total");

    // The sales list's own button keeps its filters.
    await page.goto("/fr/sales?q=Cherif");
    const [sales] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-sales").click(),
    ]);
    const [rows] = await readXlsxFile((await sales.path()) ?? "");
    expect(rows?.data).toHaveLength(2);
    expect(rows?.data[1]?.[3]).toBe("Cherif Mohamed");
  });
});

test.describe("accounting export", () => {
  test.use({ storageState: authFile("owner") });

  test("the gérant downloads the period's balanced entries", async ({ page }) => {
    await page.goto("/fr/treasury");
    await page.getByRole("link", { name: "Export comptable" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Export comptable");
    await expect(page.getByLabel("Acquéreurs (ventes, remboursements)")).toHaveAttribute(
      "placeholder",
      "411000",
    );
    await page.getByLabel("Du", { exact: true }).fill("2024-01-01");
    await expect(page).toHaveURL(/from=2024-01-01/);
    await expect(page.getByTestId("export-accounting")).toHaveAttribute("href", /from=2024-01-01/);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-accounting").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^ecritures-2024-01-01_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const [sheet] = await readXlsxFile((await download.path()) ?? "");
    expect(sheet?.sheet).toBe("Écritures");
    const rows = sheet?.data ?? [];
    expect(rows[0]).toEqual(["Journal", "Date", "Pièce", "Compte", "Libellé", "Débit", "Crédit"]);
    // Seeded collections on the cash desk and the bank, each balanced; the total too.
    expect(rows.some((r) => r[0] === "CA" && r[3] === "530000")).toBe(true);
    expect(rows.some((r) => r[0] === "BQ" && r[3] === "411000")).toBe(true);
    const total = rows.at(-1);
    expect(total?.[4]).toBe("Total");
    expect(total?.[5]).toBe(total?.[6]);
  });
});
