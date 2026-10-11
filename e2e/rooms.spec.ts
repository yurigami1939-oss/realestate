import { expect, test } from "@playwright/test";

import { authFile } from "./helpers";

/** A day two days ahead (Algiers is UTC+1: a day ahead in UTC is fine here). */
const inTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

test.describe("common rooms", () => {
  test("a resident books the salle polyvalente and the gestionnaire confirms it", async ({
    browser,
  }) => {
    // The resident (co-owner at El Yasmine) asks for a slot from the portal.
    const home = await browser.newContext({ storageState: authFile("resident") });
    const page = await home.newPage();
    await page.goto("/fr/portal");
    await page.getByRole("link", { name: "Salles", exact: true }).click();
    const room = page.locator('[data-room="Salle polyvalente"]');
    // The council's meeting is already in it, without saying whose it is.
    await expect(room).toContainText("18:00 – 20:00");
    await expect(room).not.toContainText("Conseil syndical");
    await room.getByRole("button", { name: "Réserver" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Jour").fill(inTwoDays);
    await dialog.getByLabel("De").fill("15:00");
    await dialog.getByLabel("À", { exact: true }).fill("23:00");
    await dialog.getByLabel("Objet").fill("Anniversaire de ma fille");
    await dialog.getByRole("button", { name: "Réserver" }).click();
    await expect(dialog.getByText("En dehors des horaires de la salle.")).toBeVisible();
    await dialog.getByLabel("À", { exact: true }).fill("19:00");
    await dialog.getByRole("button", { name: "Réserver" }).click();
    await expect(page.getByText("Demande envoyée : le gestionnaire vous répondra.")).toBeVisible();
    await expect(
      page.getByTestId("my-bookings").locator('[data-status="requested"]'),
    ).toContainText("Anniversaire de ma fille");

    // The gestionnaire confirms it from the residence's rooms.
    const staff = await browser.newContext({ storageState: authFile("propertyManager") });
    const manager = await staff.newPage();
    await manager.goto("/fr/residences");
    await manager
      .getByTestId("residences")
      .getByRole("link", { name: "Résidence El Yasmine" })
      .click();
    await manager.getByRole("link", { name: "Salles communes" }).click();
    const request = manager
      .getByTestId("room-bookings")
      .locator('[data-status="requested"]', { hasText: "Cherif Mohamed" });
    await expect(request).toContainText("Anniversaire de ma fille");
    await request.getByRole("button", { name: "Confirmer" }).click();
    await manager.getByRole("alertdialog").getByRole("button", { name: "Confirmer" }).click();
    await expect(manager.getByText("Réservation traitée.")).toBeVisible();
    await expect(
      manager.getByTestId("room-bookings").locator('[data-status="approved"]', {
        hasText: "Cherif Mohamed",
      }),
    ).toBeVisible();
    await staff.close();

    // The resident sees it confirmed.
    await page.reload();
    await expect(page.getByTestId("my-bookings").locator('[data-status="approved"]')).toContainText(
      "Anniversaire de ma fille",
    );
    await home.close();
  });
});
