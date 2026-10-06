import { expect, test } from "@playwright/test";
import readXlsxFile from "read-excel-file/node";

import { authFile } from "./helpers";

/** Management reports over the seeded sales (src/db/seed/reservations.ts and deliveries.ts). */
test.describe("reports", () => {
  test.use({ storageState: authFile("owner") });

  test("the gérant reads the reports and downloads them", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await page.getByRole("link", { name: "Rapports", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rapports");
    await page.getByLabel("Du", { exact: true }).fill("2024-01-01");
    await expect(page).toHaveURL(/from=2024-01-01/);
    await expect(page.getByTestId("report-by-typology").getByRole("row").nth(1)).toBeVisible();
    await expect(page.getByTestId("report-commercials")).toContainText("Lina Saadi");
    await expect(page.getByTestId("report-stock")).toContainText("Résidence Les Oliviers");
    await expect(
      page.getByTestId("report-ageing").locator('[data-bucket="undated"]'),
    ).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-report").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^rapports-2024-01-01_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const sheets = await readXlsxFile((await download.path()) ?? "");
    expect(sheets.map((s) => s.sheet)).toContain("Stock par projet et typologie");

    await page.goto("/ar/reports");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("التقارير");
  });
});
