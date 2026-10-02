import { describe, expect, it } from "vitest";

import {
  codeText,
  intText,
  moneyText,
  optionalAreaText,
  optionalDateText,
  optionalEnum,
  optionalIntText,
  optionalText,
} from "./zod";

const issue = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe("form field builders", () => {
  it("normalizes optional text and codes", () => {
    expect(optionalText().parse("  ")).toBeNull();
    expect(optionalText().parse(" Alger ")).toBe("Alger");
    expect(optionalText().parse(undefined)).toBeNull();
    expect(codeText().parse(" a-03-12 ")).toBe("A-03-12");
    expect(issue(codeText().safeParse("A 3"))).toBe("validation.code");
  });

  it("parses integers with bounds", () => {
    expect(intText(-10, 80).parse("-2")).toBe(-2);
    expect(issue(intText(0, 10).safeParse("11"))).toBe("validation.outOfRange");
    expect(issue(intText(0, 10).safeParse("1.5"))).toBe("validation.integer");
    expect(optionalIntText(1, 100).parse("")).toBeNull();
    expect(optionalIntText(1, 100).parse("25")).toBe(25);
    expect(issue(optionalIntText(1, 100).safeParse("0"))).toBe("validation.outOfRange");
  });

  it("parses areas, money and dates", () => {
    expect(optionalAreaText().parse("85,5")).toBe("85.5");
    expect(optionalAreaText().parse("")).toBeNull();
    expect(issue(optionalAreaText().safeParse("0"))).toBe("validation.area");
    expect(moneyText().parse("1 250 000,50")).toBe(125_000_050n);
    expect(issue(moneyText().safeParse("abc"))).toBe("validation.amount");
    expect(optionalDateText().parse("2026-09-30")).toBe("2026-09-30");
    expect(issue(optionalDateText().safeParse("30/09/2026"))).toBe("validation.date");
  });

  it("maps an empty select to null", () => {
    const typology = optionalEnum(["F1", "F2"] as const);
    expect(typology.parse("")).toBeNull();
    expect(typology.parse("F2")).toBe("F2");
    expect(typology.safeParse("F9").success).toBe(false);
  });
});
