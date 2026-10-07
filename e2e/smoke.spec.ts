import { expect, test } from "@playwright/test";

import { demoUsers } from "../src/db/seed/demo";
import { isPortalOnly } from "../src/lib/permissions";
import { totpFromSecret } from "../tests/totp";

import { authFile, email, signIn } from "./helpers";

test("anonymous visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/fr/settings/members");
  await expect(page).toHaveURL(/\/fr\/sign-in/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
});

test("installs as an app: manifest and icons", async ({ page, request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const body = (await manifest.json()) as { display: string; icons: { src: string }[] };
  expect(body.display).toBe("standalone");
  for (const icon of body.icons) {
    const response = await request.get(icon.src);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
  await page.goto("/fr/sign-in");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest/);
});

test("a new gérant turns on two-factor authentication, then signs in with a code", async ({
  page,
}) => {
  const stamp = Date.now();
  const address = `deux-facteurs-${stamp}@example.test`;
  const password = "e2e-only-password-2fa";
  await page.goto("/fr/sign-up");
  await page.getByLabel("Nom complet").fill("Nadir Kaci");
  await page.getByLabel("E-mail").fill(address);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Créer votre société");
  await page.getByLabel("Nom commercial").fill("Promo Kaci");
  await page.getByLabel("Identifiant").fill(`promo-kaci-${stamp}`);
  await page.getByRole("button", { name: "Créer la société" }).click();

  // The gérant is asked to protect the account.
  await page.getByTestId("secure-account").getByRole("link", { name: "L'activer" }).click();
  await page.getByRole("button", { name: "Activer la double authentification" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mot de passe").fill(password);
  await dialog.getByRole("button", { name: "Continuer" }).click();
  await expect(dialog.getByTestId("two-factor-qr")).toBeVisible();
  await expect(dialog.getByTestId("two-factor-backup").getByRole("listitem")).not.toHaveCount(0);
  const secret = (await dialog.getByTestId("two-factor-secret").textContent()) ?? "";
  await dialog.getByLabel("Code à 6 chiffres").fill(totpFromSecret(secret));
  await dialog.getByRole("button", { name: "Activer", exact: true }).click();
  await expect(page.getByText("Double authentification activée.")).toBeVisible();

  // Signed out, the password alone leads to the code.
  await page.context().clearCookies();
  await page.goto("/fr/sign-in");
  await page.getByLabel("E-mail").fill(address);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Code de vérification");
  await page.getByLabel("Code à 6 chiffres").fill("000000");
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Code incorrect." })).toBeVisible();
  await page.getByLabel("Code à 6 chiffres").fill(totpFromSecret(secret));
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page).toHaveURL(/\/fr\/dashboard$/);
  await expect(page.getByTestId("secure-account")).toHaveCount(0);
});

test("wrong password shows a translated error", async ({ page }) => {
  await page.goto("/fr/sign-in");
  await page.getByLabel("E-mail").fill(email("owner"));
  await page.getByLabel("Mot de passe").fill("not-the-password");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "E-mail ou mot de passe incorrect." }),
  ).toBeVisible();
});

test("the gérant manages members, switches organization and language", async ({ page }) => {
  await signIn(page, "owner");

  await page.getByRole("link", { name: "Membres" }).click();
  // Staff only: portal accounts (role resident) are managed from their records.
  await expect(page.getByTestId("members-table").getByRole("row")).toHaveCount(
    demoUsers.filter((u) => !isPortalOnly(u.roles)).length + 1,
  );
  await expect(page.getByRole("heading", { name: "Inviter un membre" })).toBeVisible();

  await page.getByTestId("org-switcher").click();
  await page.getByRole("menuitem", { name: "Les Jardins d'Oran" }).click();
  await expect(page.getByTestId("org-switcher")).toContainText("Les Jardins d'Oran");

  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "العربية" }).click();
  await expect(page).toHaveURL(/\/ar\/dashboard$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator('[data-slot="sidebar"][data-side="right"]')).toBeAttached();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("مرحباً");
});

test.describe("cashier", () => {
  test.use({ storageState: authFile("cashier") });

  test("sees members but cannot invite", async ({ page }) => {
    await page.goto("/fr/settings/members");
    await expect(page.getByTestId("members-table")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Inviter un membre" })).toHaveCount(0);
  });
});
