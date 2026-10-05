import { describe, expect, it } from "vitest";

import {
  canTransition,
  defaultUnitCode,
  floorCode,
  priceForArea,
  pricePerSquareMeter,
  unitStatuses,
  unitTransitions,
} from "./inventory";

describe("unit status machine", () => {
  it.each([
    ["available", "optioned"],
    ["available", "reserved"],
    ["available", "blocked"],
    ["available", "rented"],
    ["optioned", "available"],
    ["optioned", "reserved"],
    ["reserved", "available"],
    ["reserved", "sold"],
    ["sold", "delivered"],
    ["available", "delivered"],
    ["blocked", "available"],
    ["blocked", "delivered"],
    ["rented", "available"],
  ] as const)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["available", "sold"],
    ["optioned", "sold"],
    ["optioned", "delivered"],
    ["reserved", "delivered"],
    ["reserved", "blocked"],
    ["sold", "available"],
    ["delivered", "available"],
    ["blocked", "reserved"],
    ["available", "available"],
  ] as const)("refuses %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("keeps delivered terminal and only targets known statuses", () => {
    expect(unitTransitions.delivered).toEqual([]);
    for (const targets of Object.values(unitTransitions)) {
      for (const to of targets) expect(unitStatuses).toContain(to);
    }
  });
});

describe("unit codes", () => {
  it("formats floors and positions", () => {
    expect(floorCode(0)).toBe("00");
    expect(floorCode(12)).toBe("12");
    expect(floorCode(-2)).toBe("S2");
    expect(defaultUnitCode("A", 3, 2)).toBe("A-03-02");
    expect(defaultUnitCode("B", -1, 14)).toBe("B-S1-14");
  });
});

describe("pricePerSquareMeter", () => {
  it("divides exactly with half-up rounding", () => {
    // 12 500 000,00 DA / 85,50 m² = 146 198,83… DA
    expect(pricePerSquareMeter(1_250_000_000n, "85.50")).toBe(14_619_883n);
    expect(pricePerSquareMeter(1_000_000n, "100")).toBe(10_000n);
    expect(pricePerSquareMeter(1_000_000n, "100.5")).toBe(9_950n);
    expect(pricePerSquareMeter(1_000_000n, null)).toBeNull();
    expect(pricePerSquareMeter(1_000_000n, "0.00")).toBeNull();
  });
});

describe("priceForArea", () => {
  it("multiplies a price per m² by a decimal area", () => {
    expect(priceForArea(15_000_000n, "85.50")).toBe(1_282_500_000n); // 150 000 DA × 85,5 m²
    expect(priceForArea(15_000_000n, "90")).toBe(1_350_000_000n);
  });
});
