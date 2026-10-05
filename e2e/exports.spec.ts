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
