import { describe, expect, it } from "vitest";

import { buildRentPeriods, leaseEndOn, leaseState } from "./rentals";

const DA = 100n;

describe("rent schedule", () => {
  it("splits a lease in periods paid in advance, the last one shorter", () => {
    const periods = buildRentPeriods({
      startOn: "2026-01-15",
      durationMonths: 8,
      frequency: "quarterly",
      monthlyRent: 45_000n * DA,
      monthlyCharges: 5_000n * DA,
    });
    expect(periods.map((p) => [p.fromOn, p.toOn, p.months, p.amount, p.dueOn])).toEqual([
      ["2026-01-15", "2026-04-14", 3, 150_000n * DA, "2026-01-15"],
      ["2026-04-15", "2026-07-14", 3, 150_000n * DA, "2026-04-15"],
      ["2026-07-15", "2026-09-14", 2, 100_000n * DA, "2026-07-15"],
    ]);
    expect(periods[0]).toMatchObject({ rent: 135_000n * DA, charges: 15_000n * DA });
    expect(leaseEndOn("2026-01-15", 8)).toBe("2026-09-14");
  });

  it("follows month ends and keeps only the periods started when a lease ends early", () => {
    const yearly = buildRentPeriods({
      startOn: "2026-01-31",
      durationMonths: 24,
      frequency: "yearly",
      monthlyRent: 30_000n * DA,
      monthlyCharges: 0n,
    });
    expect(yearly.map((p) => [p.fromOn, p.toOn])).toEqual([
      ["2026-01-31", "2027-01-30"],
      ["2027-01-31", "2028-01-30"],
    ]);
    const monthly = buildRentPeriods({
      startOn: "2026-01-31",
      durationMonths: 12,
      frequency: "monthly",
      monthlyRent: 30_000n * DA,
      monthlyCharges: 0n,
      endedOn: "2026-04-10",
    });
    expect(monthly.map((p) => [p.fromOn, p.toOn])).toEqual([
      ["2026-01-31", "2026-02-27"],
      ["2026-02-28", "2026-03-30"],
      ["2026-03-31", "2026-04-29"],
    ]);
  });

  it("derives the state of a lease from today", () => {
    const lease = { status: "active" as const, startOn: "2026-01-01", endOn: "2026-12-31" };
    expect(leaseState(lease, "2025-12-20")).toBe("upcoming");
    expect(leaseState(lease, "2026-06-01")).toBe("running");
    expect(leaseState(lease, "2026-11-15")).toBe("ending");
    expect(leaseState(lease, "2027-01-02")).toBe("expired");
    expect(leaseState({ ...lease, status: "ended" }, "2026-06-01")).toBe("ended");
  });
});
