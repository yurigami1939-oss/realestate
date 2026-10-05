import { expect, test } from "@playwright/test";

import { authFile, expectPdf } from "./helpers";

/** The seeded deliveries of « Résidence Les Amandiers » (src/db/seed/deliveries.ts). */
test.describe("responsable technique", () => {
  test.use({ storageState: authFile("technicalManager") });
  // Documents render in the background behind each other: allow for the queue.
  test.describe.configure({ timeout: 150_000 });

  test("hands a sold unit over: appointment, reserve, PV, then its lifting", async ({ page }) => {
    await page.goto("/fr/deliveries");
    const list = page.getByTestId("deliveries");
    // What needs doing first: the planned appointment, then the units to schedule.
    await expect(list.getByRole("row").nth(1)).toHaveAttribute("data-unit", "D-02-01");
    await list.locator('[data-unit="D-03-01"]').getByRole("link", { name: "D-03-01" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Livraison du lot D-03-01");
    await expect(page.getByTestId("delivery-sale")).toContainText("Prix entièrement payé.");

    await page.getByRole("button", { name: "Planifier la remise" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Rendez-vous enregistré.")).toBeVisible();
    await expect(page.getByTestId("delivery-appointment")).toContainText(/Le \d{2}\/\d{2}\/\d{4}/);

    // A reserve found at the visit…
    await page.getByRole("button", { name: "Ajouter une réserve" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Localisation").fill("Cuisine");
    await dialog.getByLabel("Description").fill("Robinet de l'évier qui fuit");
    await dialog.getByRole("combobox", { name: "Corps d'état" }).click();
    await page.getByRole("option", { name: "Plomberie" }).click();
    await dialog.getByRole("button", { name: "Ajouter une réserve" }).click();
    await expect(page.getByTestId("punch-items")).toContainText("Robinet de l'évier qui fuit");

    // …is printed on the PV de remise des clés: the unit is delivered.
    await page.getByRole("button", { name: "Signer le PV de remise" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("La réserve ouverte figurera sur le PV.");
    await expect(dialog.getByTestId("handover-outstanding")).toHaveCount(0);
    await dialog.getByLabel("Nombre de clés").fill("3");
    await dialog.getByLabel("Compteur d'électricité").fill("004530");
    await dialog.getByRole("button", { name: "Signer le PV" }).click();
    await expect(page.getByText(/^PV PVL-\d{4}-\d{6} signé : le lot est livré\.$/)).toBeVisible();
    await expect(page.getByText("Réserves en cours", { exact: true })).toBeVisible();
    const documents = page.getByTestId("delivery-documents");
    await expectPdf(page, documents.getByRole("link", { name: "PV (PDF)", exact: true }));

    // The reserve is lifted, then closed by the PV de levée des réserves.
    await page.getByRole("button", { name: "Lever la réserve n° 1" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Lever la réserve" }).click();
    await expect(page.getByText("Réserve levée.")).toBeVisible();
    await page.getByRole("button", { name: "Établir le PV de levée" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Établir le PV" }).click();
    await expect(page.getByText("Livrée", { exact: true })).toBeVisible();
    await expectPdf(page, documents.getByRole("link", { name: "PV de levée (PDF)" }));
  });

  test("warns before handing over a unit not fully paid", async ({ page }) => {
    await page.goto("/fr/deliveries");
    await page
      .getByTestId("deliveries")
      .locator('[data-unit="D-02-02"]')
      .getByRole("link", { name: "D-02-02" })
      .click();
    await page.getByRole("button", { name: "Planifier la remise" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Rendez-vous enregistré.")).toBeVisible();
    await page.getByRole("button", { name: "Signer le PV de remise" }).click();
    await expect(page.getByRole("dialog").getByTestId("handover-outstanding")).toContainText(
      "à payer sur cette vente",
    );
  });

  test("reads the deliveries in Arabic, right to left", async ({ page }) => {
    await page.goto("/ar/deliveries");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("التسليمات");
    await expect(page.getByTestId("deliveries")).toContainText("D-02-01");
  });
});

test.describe("directrice commerciale", () => {
  test.use({ storageState: authFile("salesManager") });

  test("sees the next handover and the late reserves on the dashboard", async ({ page }) => {
    await page.goto("/fr/dashboard");
    const todo = page.getByTestId("dashboard-todo");
    await expect(todo).toContainText("Remise des clés du lot D-02-01 (Résidence Les Amandiers)");
    await expect(todo).toContainText("1 réserve en retard de levée");
    await todo.getByRole("link", { name: "1 réserve en retard de levée" }).click();
    await expect(page.getByTestId("deliveries").locator('[data-unit="D-01-01"]')).toContainText(
      "dont 1 en retard",
    );
  });
});
