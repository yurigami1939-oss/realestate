import { describe, expect, it } from "vitest";

import {
  adjustByBasisPoints,
  allocate,
  applyRate,
  formatCompactDZD,
  formatDZD,
  parseDZD,
  parsePercentToBasisPoints,
  sumCentimes,
  toDecimalString,
} from "./money";

describe("parseDZD", () => {
  it.each([
    ["300", 30_000n],
    ["1 250 000,50", 125_000_050n],
    ["1\u202f250\u202f000,5", 125_000_050n],
    ["1250000.05", 125_000_005n],
    ["0,01", 1n],
    ["  42 ", 4_200n],
  ])("parses %j", (input, expected) => {
    expect(parseDZD(input)).toBe(expected);
  });

  // "1,234" is ambiguous (thousands or decimals?) so more than 2 decimals is refused.
  it.each(["", "-5", "1,234", "1.2.3", "1,2,3", "abc", "1e5", "1 250,000"])(
    "rejects %j",
    (input) => {
      expect(parseDZD(input)).toBeNull();
    },
  );

  it("reads a single comma as the decimal separator", () => {
    expect(parseDZD("1,5")).toBe(150n);
  });
});

describe("formatDZD", () => {
  it("formats French with no-break spaces (U+00A0, present in every font) and DA", () => {
    expect(formatDZD(125_000_050n, "fr")).toBe("1\u00a0250\u00a0000,50\u00a0DA");
  });

  it("formats Arabic with Latin digits and د.ج", () => {
    const out = formatDZD(125_000_050n, "ar");
    expect(out).toMatch(/^[\d.,\u200e\u200f\u061c]+\u00a0د\.ج$/);
    expect(out.replace(/[^\d]/g, "")).toBe("125000050");
  });

  it("keeps two decimals and handles zero", () => {
    expect(formatDZD(0n, "fr")).toBe("0,00\u00a0DA");
    expect(toDecimalString(5n)).toBe("0.05");
    expect(toDecimalString(-150n)).toBe("-1.50");
  });
});

describe("applyRate", () => {
  it("applies basis points rounding half-up to the centime", () => {
    expect(applyRate(100_000n, 250)).toBe(2_500n); // 2.5 % of 1 000 DA = 25 DA
    expect(applyRate(1n, 5_000)).toBe(1n); // 0.5 centime → 1
    expect(applyRate(1n, 4_999)).toBe(0n);
    expect(applyRate(333n, 3_333)).toBe(111n);
  });

  it("refuses negative inputs", () => {
    expect(() => applyRate(-1n, 100)).toThrow(RangeError);
  });
});

describe("allocate", () => {
  it("always sums exactly to the total", () => {
    const parts = allocate(100n, [1, 1, 1]);
    expect(parts).toEqual([34n, 33n, 33n]);
    expect(sumCentimes(parts)).toBe(100n);
  });

  it("splits by tantièmes, remainder to the largest fractions", () => {
    // 1 000,00 DA over shares 150 / 250 / 600 (per 1 000)
    expect(allocate(100_000n, [150, 250, 600])).toEqual([15_000n, 25_000n, 60_000n]);
    // 10,00 DA over 3 / 3 / 1: 4.2857… 4.2857… 1.4285… → 429, 428, 143
    expect(allocate(1_000n, [3, 3, 1])).toEqual([429n, 428n, 143n]);
  });

  it("gives nothing to zero weights (e.g. ground floor excluded from elevator)", () => {
    const parts = allocate(1_001n, [0, 1, 1]);
    expect(parts[0]).toBe(0n);
    expect(sumCentimes(parts)).toBe(1_001n);
  });

  it("rejects negative totals, negative weights and all-zero weights", () => {
    expect(() => allocate(-1n, [1])).toThrow(RangeError);
    expect(() => allocate(1n, [-1, 2])).toThrow(RangeError);
    expect(() => allocate(1n, [0, 0])).toThrow(RangeError);
  });

  it("holds for many random cases", () => {
    for (let i = 0; i < 500; i += 1) {
      const total = BigInt(Math.floor(Math.random() * 10_000_000));
      const weights = Array.from({ length: 1 + Math.floor(Math.random() * 12) }, () =>
        Math.floor(Math.random() * 1_000),
      );
      if (!weights.some((w) => w > 0)) weights[0] = 1;
      const parts = allocate(total, weights);
      expect(sumCentimes(parts)).toBe(total);
      parts.forEach((p) => expect(p >= 0n).toBe(true));
    }
  });
});

describe("price adjustments", () => {
  it("adjusts by signed basis points with half-up rounding, never below zero", () => {
    expect(adjustByBasisPoints(1_000_000n, 500)).toBe(1_050_000n);
    expect(adjustByBasisPoints(1_000_000n, -250)).toBe(975_000n);
    expect(adjustByBasisPoints(333n, 1)).toBe(333n);
    expect(adjustByBasisPoints(100n, -20_000)).toBe(0n);
  });

  it("parses percentages", () => {
    expect(parsePercentToBasisPoints("5")).toBe(500n);
    expect(parsePercentToBasisPoints("-2,5")).toBe(-250n);
    expect(parsePercentToBasisPoints("0.25")).toBe(25n);
    expect(parsePercentToBasisPoints("abc")).toBeNull();
  });

  it("formats compact amounts for dense views", () => {
    expect(formatCompactDZD(1_250_000_000n, "fr")).toBe("12,5\u00a0M\u00a0DA");
  });
});
