import { describe, expect, it } from "vitest";

import { deliveryDelayDays, deliveryPenalty, documentValidity, warrantyEnds } from "./obligations";

describe("promoter's obligations", () => {
  it("flags documents expired or expiring within 60 days", () => {
    const today = "2026-10-05";
    expect(documentValidity(null, today)).toBe("permanent");
    expect(documentValidity("2026-10-04", today)).toBe("expired");
    expect(documentValidity("2026-10-05", today)).toBe("expiring");
    expect(documentValidity("2026-12-04", today)).toBe("expiring");
    expect(documentValidity("2026-12-05", today)).toBe("valid");
  });

  it("counts the delay from the contractual date to the PV, else to today", () => {
    const today = "2026-10-05";
    expect(deliveryDelayDays({ dueOn: null, deliveredOn: null, today })).toBe(0);
    expect(deliveryDelayDays({ dueOn: "2026-10-10", deliveredOn: null, today })).toBe(0);
    expect(deliveryDelayDays({ dueOn: "2026-09-05", deliveredOn: null, today })).toBe(30);
    expect(deliveryDelayDays({ dueOn: "2026-09-05", deliveredOn: "2026-09-15", today })).toBe(10);
    expect(deliveryDelayDays({ dueOn: "2026-09-05", deliveredOn: "2026-09-01", today })).toBe(0);
  });

  it("computes the indemnity on the price per month of delay, capped, off at 0 %", () => {
    const price = 13_010_000_00n;
    // 0,5 % per month over 30 days.
    expect(deliveryPenalty(price, 30, { monthlyRateBp: 50, capBp: 1_000 })).toBe(6_505_000n);
    // 15 days: half a month, half-up to the centime.
    expect(deliveryPenalty(price, 15, { monthlyRateBp: 50, capBp: 1_000 })).toBe(3_252_500n);
    // Capped at 10 % of the price.
    expect(deliveryPenalty(price, 3_000, { monthlyRateBp: 50, capBp: 1_000 })).toBe(130_100_000n);
    expect(deliveryPenalty(price, 30, { monthlyRateBp: 0, capBp: 1_000 })).toBe(0n);
    expect(deliveryPenalty(price, 0, { monthlyRateBp: 50, capBp: 1_000 })).toBe(0n);
  });

  it("runs the warranties from the handover PV", () => {
    expect(warrantyEnds("2026-02-28")).toEqual({
      completion: "2027-02-28",
      tenYear: "2036-02-28",
    });
  });
});
