import { expect, test } from "@playwright/test";

import { authFile } from "./helpers";

test.describe("visitors", () => {
  test("a resident announces a visitor and the gate records the arrival by its code", async ({
    browser,
  }) => {
    // The resident announces today's visitor and gets the code to give.
    const home = await browser.newContext({ storageState: authFile("resident") });
    const page = await home.newPage();
    await page.goto("/fr/portal");
    await page.getByRole("link", { name: "Visiteurs", exact: true }).click();
    // Tomorrow's visitors, announced earlier.
    await expect(page.getByTestId("my-visitors")).toContainText("Sofiane Cherif");
    await page.getByRole("button", { name: "Annoncer un visiteur" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Visiteur").fill("Amine Haddad");
    await dialog.getByRole("button", { name: "Annoncer un visiteur" }).click();
    await expect(page.getByText(/^Visiteur annoncé : code [A-Z0-9]{4}\.$/)).toBeVisible();
    const pass = page.getByTestId("my-visitors").locator("li", { hasText: "Amine Haddad" });
    const code = (await pass.getByTestId("pass-code").textContent())?.trim() ?? "";
    expect(code).toMatch(/^[A-Z0-9]{4}$/);

    // The gestionnaire finds it by its code and records the arrival.
    const staff = await browser.newContext({ storageState: authFile("propertyManager") });
    const gate = await staff.newPage();
    await gate.goto("/fr/residences");
    await gate.getByTestId("residences").getByRole("link", { name: "Résidence El Yasmine" }).click();
    await gate.getByRole("link", { name: "Visiteurs", exact: true }).click();
    // The delivery that came unannounced today is in the register.
    await expect(gate.getByTestId("visitors")).toContainText("Livreur Sonelgaz");
    await gate.getByLabel("Code").fill(code.toLowerCase());
    await gate.getByRole("button", { name: "Rechercher" }).click();
    const visitors = gate.getByTestId("visitors");
    await expect(visitors.locator("li")).toHaveCount(1);
    await visitors.getByRole("button", { name: "Arrivé" }).click();
    await gate.getByRole("alertdialog").getByRole("button", { name: "Arrivé" }).click();
    await expect(gate.getByText("Arrivée enregistrée.")).toBeVisible();
    await expect(visitors.locator('[data-status="arrived"]')).toContainText("Amine Haddad");
    await staff.close();

    // The resident sees them arrived.
    await page.reload();
    await expect(
      page.getByTestId("my-visitors").locator('[data-status="arrived"]', { hasText: "Amine Haddad" }),
    ).toContainText("Arrivé à");
    await home.close();
  });
});
