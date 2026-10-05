import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "./secrets";

describe("organization secrets", () => {
  it("round-trips, with a fresh nonce each time", () => {
    const sealed = encryptSecret("mot de passe SATIM é");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("SATIM");
    expect(encryptSecret("mot de passe SATIM é")).not.toBe(sealed);
    expect(decryptSecret(sealed)).toBe("mot de passe SATIM é");
  });

  it("refuses a tampered or unknown value", () => {
    const [version, iv, tag, data] = encryptSecret("secret").split(".");
    const flipped = `${data?.startsWith("A") ? "B" : "A"}${data?.slice(1) ?? ""}`;
    expect(() => decryptSecret([version, iv, tag, flipped].join("."))).toThrow();
    expect(() => decryptSecret("plain-text")).toThrow();
  });
});
