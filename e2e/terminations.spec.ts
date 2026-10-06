import { expect, test } from "@playwright/test";

import { authFile, expectPdf } from "./helpers";

/** Formal notice on the seeded overdue sale of Houda Meziane (src/db/seed/reservations.ts). */
test.describe("directrice commerciale", () => {
  test.use({ storageState: authFile("salesManager") });

  test("sends a formal notice on the way to a termination", async ({ page }) => {
    await page.goto("/fr/sales?q=Meziane");
    await page.getByTestId("sales-table").getByRole("link", { name: /^RES-/ }).first().click();
    const termination = page.getByTestId("termination");
    await expect(termination).toContainText("Aucune mise en demeure échue sur 2 requises");
    await expect(termination.getByRole("button")).toHaveCount(0);

    await page.getByRole("button", { name: "Mise en demeure" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("au moins 15 jours");
    await dialog.getByRole("button", { name: "Établir la mise en demeure" }).click();
    await expect(page.getByText(/^Mise en demeure établie/)).toBeVisible();

    await expectPdf(
      page,
      page.getByTestId("sale-reminders").getByRole("link", { name: /^Mise en demeure du/ }),
    );
  });
});
