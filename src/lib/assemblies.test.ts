import { describe, expect, it } from "vitest";

import { formatSharesPercent, isAdopted, tallyVotes } from "./assemblies";

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

  it("tally the tantièmes of the votes cast", () => {
    expect(tallyVotes([])).toEqual({ for: 0, against: 0, abstain: 0 });
    expect(
      tallyVotes([
        { choice: "for", share: 400 },
        { choice: "against", share: 300 },
        { choice: "for", share: 250 },
        { choice: "abstain", share: 50 },
      ]),
    ).toEqual({ for: 650, against: 300, abstain: 50 });
  });

  it("show a part of the tantièmes as a percentage", () => {
    const nbsp = String.fromCharCode(0xa0);
    expect(formatSharesPercent(7_000, 10_000)).toBe(`70${nbsp}%`);
    expect(formatSharesPercent(1, 3)).toBe(`33,33${nbsp}%`);
    expect(formatSharesPercent(543, 10_000)).toBe(`5,43${nbsp}%`);
    expect(formatSharesPercent(5, 0)).toBe(`0${nbsp}%`);
  });
});
