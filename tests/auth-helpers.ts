import { randomUUID } from "node:crypto";

import { auth } from "@/server/auth/auth";

export const TEST_PASSWORD = "test-only-password-123";

const cookieHeader = (headers: Headers) =>
  new Headers({
    cookie: headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });

/** Signs up a user through Better Auth; returns request headers carrying their session. */
export async function signUp(name: string) {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`;
  const { headers, response } = await auth.api.signUpEmail({
    body: { name, email, password: TEST_PASSWORD },
    returnHeaders: true,
  });
  return { email, userId: response.user.id, headers: cookieHeader(headers) };
}

export async function signIn(email: string) {
  const { headers } = await auth.api.signInEmail({
    body: { email, password: TEST_PASSWORD },
    returnHeaders: true,
  });
  return cookieHeader(headers);
}

export async function createOrganizationAs(headers: Headers) {
  const slug = `promo-${randomUUID().slice(0, 8)}`;
  const org = await auth.api.createOrganization({ body: { name: `Promo ${slug}`, slug }, headers });
  if (!org) throw new Error("organization not created");
  return org;
}
