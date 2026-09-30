import { describe, expect, it } from "vitest";

import { sumCentimes } from "./money";
import { buildSchedule, formatShare, netPrice, type PlanStep, totalShare } from "./payment-plans";

const step = (shareBp: number, extra: Partial<PlanStep> = {}): PlanStep => ({
  label: `Tranche ${shareBp}`,
  shareBp,
  trigger: "signing",
  months: null,
  milestoneId: null,
  ...extra,
});

describe("buildSchedule", () => {
  it("dates each step from the signing day or the milestone's planned date", () => {
    const lines = buildSchedule(
      13_010_000_00n,
      [
        step(2_000),
        step(3_000, { trigger: "milestone", milestoneId: "m1" }),
        step(3_000, { trigger: "months_after_signing", months: 12 }),
        step(2_000, { trigger: "milestone", milestoneId: "unknown" }),
      ],
      "2026-01-31",
      [{ id: "m1", name: "Gros œuvre", plannedOn: "2027-03-15" }],
    );
    expect(lines.map((l) => [l.position, l.dueOn, l.milestoneName, l.amount])).toEqual([
      [1, "2026-01-31", null, 2_602_000_00n],
      [2, "2027-03-15", "Gros œuvre", 3_903_000_00n],
      [3, "2027-01-31", null, 3_903_000_00n],
      [4, null, null, 2_602_000_00n],
    ]);
  });

  it("always sums exactly to the price (random prices and shares)", () => {
    for (let run = 0; run < 500; run++) {
      const price = BigInt(Math.floor(Math.random() * 5e10));
      const count = 1 + Math.floor(Math.random() * 8);
      const cuts = Array.from({ length: count - 1 }, () => 1 + Math.floor(Math.random() * 9_999))
        .sort((a, b) => a - b)
        .filter((v, i, all) => all.indexOf(v) === i);
      const bounds = [0, ...cuts, 10_000];
      const steps = bounds.slice(1).map((b, i) => step(b - (bounds[i] ?? 0)));
      expect(totalShare(steps)).toBe(10_000);
      const lines = buildSchedule(price, steps, "2026-06-01", []);
      expect(sumCentimes(lines.map((l) => l.amount))).toBe(price);
    }
  });

  it("handles a zero price and an empty plan", () => {
    expect(buildSchedule(0n, [step(10_000)], "2026-06-01", [])[0]?.amount).toBe(0n);
    expect(buildSchedule(1_000n, [], "2026-06-01", [])).toEqual([]);
  });
});

describe("helpers", () => {
  it("formats shares and net prices", () => {
    expect(formatShare(2_000)).toBe("20\u00a0%");
    expect(formatShare(1_250)).toBe("12,5\u00a0%");
    expect(formatShare(1_205)).toBe("12,05\u00a0%");
    expect(netPrice(10_000n, 2_500n)).toBe(7_500n);
    expect(netPrice(10_000n, 20_000n)).toBe(0n);
  });
});
