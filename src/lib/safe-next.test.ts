import { describe, expect, it } from "vitest";

import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it.each([
    ["/accept-invitation/abc", "/accept-invitation/abc"],
    ["/fr/accept-invitation/abc", "/accept-invitation/abc"],
    ["/ar/settings?tab=members", "/settings?tab=members"],
    ["/ar", "/dashboard"],
    ["/", "/dashboard"],
    ["/france", "/france"],
  ])("keeps same-site path %s → %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each([
    undefined,
    "",
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "javascript:alert(1)",
    ["/x"],
  ])("rejects %j", (input) => {
    expect(safeNext(input)).toBe("/dashboard");
  });
});
