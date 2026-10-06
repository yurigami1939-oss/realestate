import { describe, expect, it } from "vitest";

import { invoiceSplit, nextMonths, projectMargin, spreadRemaining } from "./costs";

describe("construction costs", () => {
  it("keeps the retention of a progress invoice, half-up, the net being the rest", () => {
    expect(invoiceSplit(12_345_678_91n, 500)).toEqual({
      retention: 61_728_395n,
      net: 1_172_839_496n,
    });
    expect(invoiceSplit(100_00n, 0)).toEqual({ retention: 0n, net: 100_00n });
  });

  it("lists the next months and spreads what remains to invoice until the planned end", () => {
    expect(nextMonths("2026-11-30", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect([...spreadRemaining(1_000n, "2026-10-06", "2026-12-31")]).toEqual([
      ["2026-10", 334n],
      ["2026-11", 333n],
      ["2026-12", 333n],
    ]);
    // A past or unknown end: everything this month.
    expect([...spreadRemaining(500n, "2026-10-06", "2026-01-31")]).toEqual([["2026-10", 500n]]);
    expect([...spreadRemaining(500n, "2026-10-06", null)]).toEqual([["2026-10", 500n]]);
    expect([...spreadRemaining(0n, "2026-10-06", "2027-01-31")]).toEqual([]);
  });

  it("forecasts the margin on the larger of budget and committed per category", () => {
    expect(
      projectMargin({
        signed: 600n,
        stock: 400n,
        budget: { land: 100n, works: 500n },
        committed: { works: 550n, studies: 30n },
      }),
    ).toEqual({ revenue: 1_000n, cost: 680n, margin: 320n, rateBp: 3_200 });
    expect(projectMargin({ signed: 0n, stock: 0n, budget: {}, committed: {} }).rateBp).toBeNull();
  });
});
