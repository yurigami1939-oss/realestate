import { expect, test } from "@playwright/test";

import { authFile, expectPdf, PNG } from "./helpers";

test.describe("sales manager", () => {
  test.use({ storageState: authFile("salesManager") });

  test("builds, prices and documents a new project", async ({ page }) => {
    await page.goto("/fr/dashboard");

    // Project
    await page.getByRole("link", { name: "Projets", exact: true }).click();
    await page.getByRole("link", { name: "Nouveau projet" }).click();
    await page.getByLabel("Nom").fill("Résidence du Jardin");
    await page.getByLabel("Code", { exact: true }).fill("jard");
    await page.getByLabel("Commune").fill("Chéraga");
    await page.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Résidence du Jardin");
    await expect(page.getByText("JARD", { exact: true })).toBeVisible();

    // Building
    await page.getByRole("button", { name: "Ajouter un bâtiment" }).click();
    const buildingDialog = page.getByRole("dialog");
    await buildingDialog.getByLabel("Code", { exact: true }).fill("A");
    await buildingDialog.getByLabel("Nom").fill("Bloc A");
    await buildingDialog.getByLabel("Niveau le plus bas").fill("0");
    await buildingDialog.getByLabel("Dernier étage").fill("3");
    await buildingDialog.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByTestId("building-list")).toContainText("Bloc A");
    await page.getByRole("link", { name: "Voir la grille" }).click();

    // Units: floors 1-3, 2 F3 of 80 m² per floor
    await page.getByRole("button", { name: "Générer des lots" }).click();
    const generateDialog = page.getByRole("dialog");
    await expect(generateDialog.locator("bdi")).toHaveText("A-03-02");
    await generateDialog.getByLabel("Lots par étage").fill("2");
    await generateDialog.getByRole("combobox", { name: "Typologie" }).click();
    await page.getByRole("option", { name: "F3", exact: true }).click();
    await generateDialog.getByLabel("Surface habitable (m²)").fill("80");
    await generateDialog.getByRole("button", { name: "Générer" }).click();
    await expect(page.getByText("6 lots créés · 0 ignoré(s).")).toBeVisible();
    await expect(page.getByTestId("unit-grid").locator('[data-status="available"]')).toHaveCount(6);

    // Price list: 100 000 DA/m² × 80 m², applied
    await page.getByRole("link", { name: "Résidence du Jardin" }).click();
    await page.getByRole("link", { name: "Grilles de prix" }).click();
    await page.getByRole("button", { name: "Nouvelle grille" }).click();
    await page.getByRole("dialog").getByLabel("Nom").fill("Lancement");
    await page.getByRole("dialog").getByRole("button", { name: "Créer" }).click();
    await page.getByLabel("Prix au m² (DA)").fill("100000");
    await page.getByRole("button", { name: "Surface × prix au m²" }).click();
    await expect(page.getByLabel("Nouveau prix A-01-01")).toHaveValue(/^8\s000\s000,00$/);
    await page.getByRole("button", { name: "Appliquer la grille" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Appliquer la grille" })
      .click();
    await expect(page.getByText("6 prix modifiés.")).toBeVisible();
    await expect(page.getByText("Cette grille est en lecture seule.")).toBeVisible();

    // Unit sheet: price, block with a reason, floor plan
    await page.getByRole("link", { name: "Résidence du Jardin" }).click();
    await page.getByRole("link", { name: "Voir la grille" }).click();
    await page.getByRole("link", { name: /^A-01-01/ }).click();
    await expect(page.getByTestId("unit-price")).toHaveText(/^8\s000\s000,00\sDA$/);

    await page.getByRole("button", { name: "Bloquer" }).click();
    await page.getByRole("dialog").getByLabel("Motif").fill("Appartement témoin");
    await page.getByRole("dialog").getByRole("button", { name: "Confirmer" }).click();
    await expect(page.getByText("Lot bloqué.")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Appartement témoin" })).toBeVisible();

    await page
      .getByTestId("upload-unit.floor_plan")
      .setInputFiles({ name: "plan A-01-01.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("Plan enregistré.")).toBeVisible();
    const plan = page.getByTestId("floor-plan");
    await expect(plan).toContainText("plan A-01-01.png");
    await expect(plan.getByRole("img")).toHaveJSProperty("naturalWidth", 1);

    // Download: redirect to a short-lived presigned URL serving the stored bytes
    const href = await plan.getByRole("link", { name: "Télécharger" }).getAttribute("href");
    const redirect = await page.request.get(href ?? "", { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers()["location"]).toContain("X-Amz-Expires=300");
    const download = await page.request.get(href ?? "");
    expect(download.headers()["content-type"]).toBe("image/png");
    expect(download.headers()["content-disposition"]).toContain("attachment;");
    expect(Buffer.from(await download.body())).toEqual(PNG);
  });
});

test.describe("commercial", () => {
  test.use({ storageState: authFile("salesAgent") });

  test("browses the seeded stock without edit controls", async ({ page }) => {
    await page.goto("/fr/dashboard");

    await page.getByRole("link", { name: "Projets", exact: true }).click();
    await page.getByRole("link", { name: "Résidence Les Oliviers" }).click();
    await expect(page.getByRole("link", { name: "Modifier le projet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ajouter un bâtiment" })).toHaveCount(0);

    await page.getByRole("link", { name: "Grilles de prix" }).click();
    await expect(page.getByRole("row")).toHaveCount(3);
    await expect(page.getByRole("row", { name: /Révision 2027/ })).toContainText("Brouillon");
    await expect(page.getByRole("button", { name: "Nouvelle grille" })).toHaveCount(0);
    await page.goBack();

    await page.getByRole("link", { name: "Voir la grille" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bloc A");
    await page.getByRole("button", { name: "Bloqué · 1" }).click();
    await expect(page.getByRole("button", { name: "Bloqué · 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.locator('[data-status="blocked"]').click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A-01-01");
    await expect(
      page.getByRole("cell", { name: "Logement de fonction réservé au gérant" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Modifier" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Bloquer|Débloquer|Modifier le prix/ }),
    ).toHaveCount(0);
    await expect(page.getByTestId("floor-plan")).toContainText("Aucun plan pour ce lot.");
    await expect(page.getByTestId("upload-unit.floor_plan")).toHaveCount(0);

    // The fiche du lot to hand to a prospect.
    await page
      .getByTestId("unit-sheets")
      .getByRole("button", { name: "Éditer la fiche (PDF)" })
      .click();
    await expect(page.getByText("Fiche en préparation.")).toBeVisible();
    await expectPdf(
      page,
      page.getByTestId("unit-sheets").getByRole("link", { name: /^Fiche du / }),
    );

    // Same sheet in Arabic: right-to-left, translated labels, codes and amounts kept LTR
    await page.goto(page.url().replace("/fr/", "/ar/"));
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("floor-plan")).toContainText("مخطط الوحدة");
    await expect(page.getByTestId("unit-price")).toHaveAttribute("dir", "ltr");
  });
});
