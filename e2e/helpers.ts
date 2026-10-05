import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { DEMO_PASSWORD, demoUsers } from "../src/db/seed/demo";

export type DemoUserKey = (typeof demoUsers)[number]["key"];

export const email = (key: DemoUserKey) => demoUsers.find((u) => u.key === key)?.email ?? "";

/** Saved session of a demo user, written by `auth.setup.ts`. */
export const authFile = (key: DemoUserKey) => `e2e/.auth/${key}.json`;

/** Signs in through the form (tests that exercise the sign-in page itself). */
export async function signIn(page: Page, key: DemoUserKey) {
  await page.goto("/fr/sign-in");
  await page.getByLabel("E-mail").fill(email(key));
  await page.getByLabel("Mot de passe").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/fr\/dashboard$/);
}

/**
 * Signs in through the Better Auth API, waiting out its sign-in rate limit
 * (3 attempts per 10 s per client in production builds).
 */
export async function signInWithApi(request: APIRequestContext, baseURL: string, key: DemoUserKey) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await request.post("/api/auth/sign-in/email", {
      headers: { origin: baseURL },
      data: { email: email(key), password: DEMO_PASSWORD },
    });
    if (response.status() !== 429) {
      expect(response.status(), await response.text()).toBe(200);
      return;
    }
    const retryAfter = Number(response.headers()["x-retry-after"] ?? "10");
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
  }
  throw new Error(`signInWithApi: ${key} still rate-limited`);
}

/**
 * A generated PDF: the worker renders documents one at a time (those of the previous test may
 * still be queued), so the page is reloaded until its link appears.
 */
export async function expectPdf(page: Page, link: Locator) {
  await expect(async () => {
    if (!(await link.isVisible())) await page.reload();
    await expect(link).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
  const pdf = await page.request.get((await link.getAttribute("href")) ?? "");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
}
