import { describe, expect, it } from "vitest";

import {
  averageLots,
  invoiceState,
  invoiceTotals,
  lineAmount,
  monthlyEquivalent,
  syndicTrueUp,
} from "./billing";

describe("operator billing rules (CLAUDE.console.md §11)", () => {
  it("totals lines with VAT half-up on the total, none without a rate", () => {
    const lines = [{ amount: lineAmount(1, 333_33n) }, { amount: lineAmount(3, 111_11n) }];
    expect(invoiceTotals(lines, 1900)).toEqual({ ht: 666_66n, vat: 126_67n, ttc: 793_33n });
    expect(invoiceTotals(lines, null)).toEqual({ ht: 666_66n, vat: 0n, ttc: 666_66n });
  });

  it("derives an invoice's state", () => {
    const base = { totalTtc: 1_000_00n, credited: 0n, paid: 0n, dueOn: "2026-10-10" };
    expect(invoiceState(base, "2026-10-10")).toBe("due");
    expect(invoiceState(base, "2026-10-11")).toBe("overdue");
    expect(invoiceState({ ...base, paid: 400_00n }, "2026-10-11")).toBe("overdue");
    expect(invoiceState({ ...base, paid: 400_00n, credited: 600_00n }, "2026-10-11")).toBe("paid");
    expect(invoiceState({ ...base, credited: 1_000_00n }, "2026-10-11")).toBe("credited");
  });

  it("gives a subscription's monthly equivalent: price after discount, add-ons, syndic lots", () => {
    const yearly = { price: 1_200_000_00n, discountBp: 1000, billingPeriod: "yearly" as const };
    expect(monthlyEquivalent(yearly, [], 0)).toBe(90_000_00n);
    expect(
      monthlyEquivalent(
        yearly,
        [
          { basis: "flat", price: 120_000_00n },
          { basis: "per_managed_lot", price: 300_00n },
        ],
        60,
      ),
    ).toBe(90_000_00n + 10_000_00n + 18_000_00n);
    // Quarterly: a third of the period's price; half-up to the centime.
    expect(
      monthlyEquivalent({ price: 100_00n, discountBp: 0, billingPeriod: "quarterly" }, [], 0),
    ).toBe(33_33n);
    expect(
      monthlyEquivalent({ price: 200_00n, discountBp: 0, billingPeriod: "quarterly" }, [], 0),
    ).toBe(66_67n);
  });

  it("trues up the syndic on the lots managed on average beyond those billed, never below", () => {
    expect(averageLots([60, 60, 80, 80])).toBe(70);
    expect(averageLots([60, 61])).toBe(61);
    expect(averageLots([])).toBe(0);
    expect(syndicTrueUp({ averageLots: 70, billedLots: 60, months: 12 })).toBe(120);
    expect(syndicTrueUp({ averageLots: 50, billedLots: 60, months: 12 })).toBe(0);
  });
});
