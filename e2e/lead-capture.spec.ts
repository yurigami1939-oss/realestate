import { expect, test } from "@playwright/test";

import { authFile } from "./helpers";

/** Leads sent by a website or an automation with a capture key (CLAUDE.md §7 CRM). */
test.describe("directrice commerciale", () => {
  test.use({ storageState: authFile("salesManager") });

  test("creates a capture key and receives a lead sent with it", async ({ page, request }) => {
    await page.goto("/fr/settings/lead-capture");
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nom (site, campagne…)").fill("Formulaire du site");
    await dialog.getByRole("button", { name: "Créer une clé" }).click();
    const key = (await page.getByTestId("capture-key").textContent())?.trim() ?? "";
    expect(key).toMatch(/^lck_/);
    await page.getByRole("button", { name: "J'ai copié la clé" }).click();
    await expect(page.getByTestId("capture-keys")).toContainText("Formulaire du site");

    const endpoint = await page.locator("pre").first().textContent();
    const url = endpoint?.match(/POST (\S+)/)?.[1] ?? "";
    const response = await request.post(url, {
      headers: { authorization: `Bearer ${key}` },
      data: {
        fullName: "Yasmine Belkacem",
        phone: "0770 11 22 33",
        message: "Intéressée par un F4",
      },
    });
    expect(response.status()).toBe(200);

    await page.goto(`/fr/leads?q=${encodeURIComponent("Yasmine Belkacem")}`);
    await expect(page.getByTestId("leads-table")).toContainText("Yasmine Belkacem");
  });
});
