import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { user } from "@/db/schema";

import { signUp, TEST_PASSWORD } from "../../../tests/auth-helpers";
import { totpCode } from "../../../tests/totp";

import { auth } from "./auth";

/** The cookies a response set, as the next request's header. */
const cookies = (headers: Headers) =>
  new Headers({
    cookie: headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });

describe("two-factor authentication", () => {
  it("is switched on with a first code, then asked at every sign-in", async () => {
    const { email, userId, headers } = await signUp("Gerant");
    await expect(
      auth.api.enableTwoFactor({ body: { password: "wrong-password-123" }, headers }),
    ).rejects.toThrow();
    const setup = await auth.api.enableTwoFactor({ body: { password: TEST_PASSWORD }, headers });
    if (!("totpURI" in setup)) throw new Error("no TOTP link");
    expect(setup.backupCodes.length).toBeGreaterThan(0);

    // Not on until a first code from the app confirms it.
    const enabled = async () =>
      (await db.select({ on: user.twoFactorEnabled }).from(user).where(eq(user.id, userId)))[0]?.on;
    expect(await enabled()).toBe(false);
    await auth.api.verifyTOTP({ body: { code: totpCode(setup.totpURI) }, headers });
    expect(await enabled()).toBe(true);

    // The password alone no longer opens a session.
    const signIn = async () => {
      const result = await auth.api.signInEmail({
        body: { email, password: TEST_PASSWORD },
        returnHeaders: true,
      });
      expect(result.response).toMatchObject({ twoFactorRedirect: true });
      return cookies(result.headers);
    };
    const pending = await signIn();
    await expect(
      auth.api.verifyTOTP({ body: { code: "000000" }, headers: pending }),
    ).rejects.toThrow();
    const verified = await auth.api.verifyTOTP({
      body: { code: totpCode(setup.totpURI) },
      headers: pending,
      returnHeaders: true,
    });
    const session = await auth.api.getSession({ headers: cookies(verified.headers) });
    expect(session?.user.id).toBe(userId);

    // A backup code works once.
    const [backup] = setup.backupCodes;
    if (!backup) throw new Error("no backup code");
    await auth.api.verifyBackupCode({ body: { code: backup }, headers: await signIn() });
    await expect(
      auth.api.verifyBackupCode({ body: { code: backup }, headers: await signIn() }),
    ).rejects.toThrow();
  });
});
