import { describe, expect, it } from "vitest";

import {
  canTransition,
  defaultUnitCode,
  floorCode,
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
    ["blocked", "available"],
    ["rented", "available"],
  ] as const)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["available", "sold"],
    ["available", "delivered"],
    ["optioned", "sold"],
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
