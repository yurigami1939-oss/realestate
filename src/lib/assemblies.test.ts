import { describe, expect, it } from "vitest";

import { isAdopted } from "./assemblies";

describe("assembly majorities", () => {
  const total = 10_000;
  it("count tantièmes according to each majority", () => {
    const tally = { for: 4_000, against: 3_000, abstain: 1_000 };
    expect(isAdopted("simple", tally, total)).toBe(true);
    expect(isAdopted("absolute", tally, total)).toBe(false);
    expect(isAdopted("absolute", { ...tally, for: 5_001 }, total)).toBe(true);
    expect(isAdopted("absolute", { ...tally, for: 5_000 }, total)).toBe(false);
    expect(isAdopted("two_thirds", { ...tally, for: 6_666 }, total)).toBe(false);
    expect(isAdopted("two_thirds", { ...tally, for: 6_667 }, total)).toBe(true);
    expect(isAdopted("unanimity", { ...tally, for: 9_999 }, total)).toBe(false);
    expect(isAdopted("unanimity", { for: 10_000, against: 0, abstain: 0 }, total)).toBe(true);
    expect(isAdopted("simple", { for: 2_000, against: 2_000, abstain: 0 }, total)).toBe(false);
  });
});
