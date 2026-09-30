import { expect, type Page, test } from "@playwright/test";

import { DEMO_PASSWORD, demoUsers } from "../src/db/seed/demo";

const email = (key: (typeof demoUsers)[number]["key"]) =>
  demoUsers.find((u) => u.key === key)?.email ?? "";

async function signIn(page: Page, userEmail: string) {
  await page.goto("/fr/sign-in");
  await page.getByLabel("E-mail").fill(userEmail);
  await page.getByLabel("Mot de passe").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/fr\/dashboard$/);
}

test("anonymous visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/fr/settings/members");
  await expect(page).toHaveURL(/\/fr\/sign-in/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
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
  await signIn(page, email("owner"));

  await page.getByRole("link", { name: "Membres" }).click();
  await expect(page.getByTestId("members-table").getByRole("row")).toHaveCount(
    demoUsers.length + 1,
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

test("a cashier sees members but cannot invite", async ({ page }) => {
  await signIn(page, email("cashier"));
  await page.goto("/fr/settings/members");
  await expect(page.getByTestId("members-table")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inviter un membre" })).toHaveCount(0);
});
