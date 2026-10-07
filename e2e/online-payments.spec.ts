import { expect, test } from "@playwright/test";

import { authFile, expectPdf } from "./helpers";

/**
 * Online payment through the local SATIM stand-in (DEV_GATEWAYS): the demo promoter's gateway is
 * on SATIM's test platform (src/db/seed/online-payments.ts).
 */
test.describe("paiement en ligne", () => {
  // Receipts render in the background behind the other documents.
  test.describe.configure({ timeout: 150_000 });

  test.describe("acquéreur", () => {
    test.use({ storageState: authFile("resident") });

    test("pays an installment by card and gets the receipt", async ({ page }) => {
      await page.goto("/fr/portal");
      await page
        .getByTestId("portal-sales")
        .getByRole("link", { name: "Résidence Les Oliviers · B-02-02" })
        .click();
      await page
        .getByTestId("portal-pay-online")
        .getByRole("button", { name: "Payer en ligne" })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("Mode test : aucune carte n'est débitée.");
      await dialog.getByLabel("Montant (DA)").fill("25 000");
      // The conditions must be accepted first.
      await dialog.getByRole("button", { name: "Continuer vers le paiement" }).click();
      await expect(dialog.getByText("Acceptez les conditions de paiement en ligne.")).toBeVisible();
      await dialog.getByLabel("J'accepte les conditions de paiement en ligne").check();
      await dialog.getByRole("button", { name: "Continuer vers le paiement" }).click();

      // SATIM's page (the stand-in), then back to the result page.
      await expect(page.getByRole("heading", { name: "Paiement CIB / Edahabia" })).toBeVisible();
      await expect(page.getByText("25 000,00 DA")).toBeVisible();
      await page.getByRole("button", { name: "Payer · ادفع" }).click();
      await expect(page).toHaveURL(/\/fr\/portal\/payments\/[0-9a-f-]{36}$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paiement accepté");
      await expect(page.getByTestId("online-payment-message")).toContainText(
        "Votre paiement a été accepté",
      );
      await expect(page.getByText("Numéro vert de la SATIM : 3020")).toBeVisible();
      await expectPdf(page, page.getByRole("link", { name: /^Reçu REC-\d{4}-\d{6}$/ }));

      // The sale shows the card payment.
      await page.getByRole("link", { name: "Retour" }).click();
      await expect(page.getByTestId("portal-payments")).toContainText("Carte CIB / Edahabia");
    });

    test("is told when the card is declined", async ({ page }) => {
      await page.goto("/fr/portal");
      await page
        .getByTestId("portal-sales")
        .getByRole("link", { name: "Résidence Les Oliviers · B-02-02" })
        .click();
      await page
        .getByTestId("portal-pay-online")
        .getByRole("button", { name: "Payer en ligne" })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Montant (DA)").fill("10 000");
      await dialog.getByLabel("J'accepte les conditions de paiement en ligne").check();
      await dialog.getByRole("button", { name: "Continuer vers le paiement" }).click();
      await page.getByRole("button", { name: "Refuser la carte · رفض البطاقة" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paiement non effectué");
      await expect(page.getByTestId("online-payment-message")).toContainText(
        "Votre transaction a été rejetée",
      );

      await page.getByRole("link", { name: "Tous mes paiements en ligne" }).click();
      const history = page.getByTestId("portal-online-payments");
      await expect(history.getByRole("listitem")).toHaveCount(2);
      await expect(history).toContainText("Échoué");
      await expect(history).toContainText("Payé");
    });
  });

  test("the cashier follows the online payments", async ({ browser }) => {
    const staff = await browser.newContext({ storageState: authFile("cashier") });
    const page = await staff.newPage();
    await page.goto("/fr/dashboard");
    await page.getByRole("link", { name: "Paiements en ligne" }).click();
    const rows = page.getByTestId("online-payments").getByRole("row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText("Échoué");
    await expect(rows.nth(2)).toContainText("Payé");
    await expect(rows.nth(2)).toContainText(/REC-\d{4}-\d{6}/);
    await staff.close();
  });

  test("the gérant sees the SATIM account, its password kept secret", async ({ browser }) => {
    const owner = await browser.newContext({ storageState: authFile("owner") });
    const page = await owner.newPage();
    await page.goto("/fr/settings/online-payment");
    await expect(page.getByTestId("satim-stand-in")).toBeVisible();
    await expect(page.getByLabel("Identifiant marchand")).toHaveValue("demo-marchand");
    await expect(page.getByLabel("Mot de passe")).toHaveValue("");
    await page.goto("/ar/settings/online-payment");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الدفع الإلكتروني (ساتيم)");
    await owner.close();
  });

  // Last: the cashier's list above counts the sale payments only.
  test.describe("locataire", () => {
    test.use({ storageState: authFile("resident") });

    test("pays next month's rent by card and gets the quittance", async ({ page }) => {
      await page.goto("/fr/portal");
      await page
        .getByTestId("portal-leases")
        .getByRole("link", { name: "Résidence Les Amandiers · D-02-03" })
        .click();
      await expect(page.getByTestId("portal-rent-payments")).toContainText("Quittance QIT-");
      await page
        .getByTestId("portal-pay-online")
        .getByRole("button", { name: "Payer en ligne" })
        .click();
      const dialog = page.getByRole("dialog");
      // Rent paid to date: the next month is offered.
      await expect(dialog.getByLabel("Montant (DA)")).toHaveValue(/^32\s000,00$/);
      await dialog.getByLabel("J'accepte les conditions de paiement en ligne").check();
      await dialog.getByRole("button", { name: "Continuer vers le paiement" }).click();
      await page.getByRole("button", { name: "Payer · ادفع" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paiement accepté");
      await expectPdf(page, page.getByRole("link", { name: /^Reçu QIT-\d{4}-\d{6}$/ }));
      await page.getByRole("link", { name: "Retour" }).click();
      await expect(page.getByTestId("portal-rent-payments")).toContainText("Carte CIB / Edahabia");
    });
  });
});
