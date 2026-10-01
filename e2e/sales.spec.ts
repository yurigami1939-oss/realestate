import { expect, type Page, test } from "@playwright/test";

import { authFile } from "./helpers";

/** Opens a lead from the list, searching by name. */
async function openLead(page: Page, name: string) {
  await page.goto(`/fr/leads?q=${encodeURIComponent(name)}`);
  await page.getByTestId("leads-table").getByRole("link", { name, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
}

test.describe("commercial and cashier", () => {
  test.use({ storageState: authFile("salesAgent") });

  test("lead → option → reservation → payment → receipt PDF", async ({ page, browser }) => {
    // The commercial holds a unit for the prospect…
    await openLead(page, "Omar Benali");
    const options = page.getByTestId("lead-options");
    await options.getByRole("button", { name: "Poser une option" }).click();
    await page.getByRole("dialog").getByRole("combobox", { name: "Lot" }).click();
    await page.getByRole("option", { name: "A-02-03", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Poser une option" }).click();
    await expect(page.getByText(/^Option posée jusqu'au/)).toBeVisible();
    await expect(options).toContainText("A-02-03");

    // …opens the buyer file from the lead…
    await page.getByRole("link", { name: "Créer la fiche acquéreur" }).click();
    await expect(page.getByLabel("Nom", { exact: true })).toHaveValue("Benali");
    await page.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByText("Fiche acquéreur créée.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Benali Omar");

    // …and reserves the optioned unit with the project's default plan.
    await page.getByRole("link", { name: "Réserver" }).click();
    await page.getByRole("combobox", { name: "Projet" }).click();
    await page.getByRole("option", { name: "Résidence Les Oliviers" }).click();
    await page.getByRole("combobox", { name: "Lot" }).click();
    await page.getByRole("option", { name: /^A-02-03 · .* · option de Omar Benali$/ }).click();
    await expect(
      page.getByText(
        "Ce lot est en option pour Omar Benali : l'option sera convertie en réservation.",
      ),
    ).toBeVisible();
    await expect(page.getByTestId("reservation-schedule").getByRole("row")).toHaveCount(6);
    await page.getByRole("button", { name: "Enregistrer la réservation" }).click();
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(/^Réservation RES-\d{4}-\d{6}$/);
    const number = ((await heading.textContent()) ?? "").replace("Réservation ", "");
    await expect(page.getByTestId("sale-statement").getByRole("row")).toHaveCount(5);
    await expect(page.getByTestId("missing-documents")).toBeVisible();
    // The worker renders the reservation sheet; commercials do not record payments.
    await expect(page.getByRole("link", { name: `${number}.pdf` })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Enregistrer un paiement" })).toHaveCount(0);
    const saleUrl = page.url();

    // A commercial only sees their own sales.
    await page.goto("/fr/sales");
    await expect(page.getByTestId("sales-table")).toContainText(number);
    await expect(page.getByTestId("sales-table")).toContainText("Boudiaf Karima");
    await expect(page.getByTestId("sales-table")).not.toContainText("Meziane Houda");

    // The cashier records the payment; its receipt is numbered and rendered by the worker.
    const cashierContext = await browser.newContext({ storageState: authFile("cashier") });
    const cashier = await cashierContext.newPage();
    await cashier.goto(saleUrl);
    await cashier.getByRole("button", { name: "Enregistrer un paiement" }).click();
    const dialog = cashier.getByRole("dialog");
    await expect(dialog.getByLabel("Versé par")).toHaveValue("Omar Benali");
    await dialog.getByLabel("Montant (DA)").fill("1 000 000");
    await dialog.getByRole("button", { name: "Enregistrer un paiement" }).click();
    await expect(cashier.getByText(/^Paiement enregistré, reçu REC-\d{4}-\d{6}\.$/)).toBeVisible();
    await expect(cashier.getByTestId("statement-totals")).toContainText(
      /Encaissé\s*1\s000\s000,00\sDA/,
    );
    const receipt = cashier.getByTestId("sale-payments").getByRole("link", { name: /^REC-/ });
    await expect(receipt).toBeVisible({ timeout: 30_000 });
    const pdf = await cashier.request.get((await receipt.getAttribute("href")) ?? "");
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    // The cashier also follows the overdue installments of every sale.
    await cashier.goto("/fr/sales/overdue");
    await expect(cashier.getByTestId("overdue-table")).toContainText("Meziane Houda");
    await cashierContext.close();
  });
});

test.describe("directrice commerciale", () => {
  test.use({ storageState: authFile("salesManager") });

  test("sees the seeded VSP with its payment call, bank loan and commission", async ({ page }) => {
    await page.goto("/fr/sales?status=sold");
    await page.getByTestId("sales-table").getByRole("link", { name: /^RES-/ }).first().click();
    await expect(page.getByTestId("vsp-signed")).toContainText(/^VSP VSP-\d{4}-\d{6} signée le/);
    await expect(page.getByTestId("sale-payment-calls")).toContainText("Achèvement du gros œuvre");
    await expect(page.getByTestId("bank-loans")).toContainText("CNEP-Banque");
    await expect(page.getByTestId("sale-commission")).toContainText("1,5");
  });
});
