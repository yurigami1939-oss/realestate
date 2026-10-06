import { expect, test } from "@playwright/test";

import { authFile, expectPdf } from "./helpers";

/** Avenant on the seeded sale of Djamel and Samia Benchikh (src/db/seed/reservations.ts). */
test.describe("directrice commerciale", () => {
  test.use({ storageState: authFile("salesManager") });

  test("reschedules what remains in monthly installments by an avenant", async ({ page }) => {
    await page.goto("/fr/sales?q=Benchikh");
    await page.getByTestId("sales-table").getByRole("link", { name: /^RES-/ }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Réservation RES-/);

    await page.getByRole("button", { name: "Rééchelonner (avenant)" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Motif de l'avenant").fill("Report demandé après une mutation");
    await dialog.getByLabel("Mensualités").fill("12");
    await dialog.getByRole("button", { name: "Étaler le reste" }).click();
    await expect(dialog.getByTestId("amendment-line")).toHaveCount(12);
    await expect(dialog.getByTestId("amendment-total")).toHaveClass(/text-emerald-700/);
    await dialog.getByRole("button", { name: "Enregistrer l'avenant" }).click();
    await expect(page.getByText(/^Avenant n° 1 enregistré/)).toBeVisible();

    await expect(page.locator("main")).toContainText("Mensualité 12/12");
    await expectPdf(
      page,
      page.getByTestId("sale-amendments").getByRole("link", { name: /^Avenant n° 1 du/ }),
    );
  });
});
