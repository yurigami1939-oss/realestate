import { describe, expect, it } from "vitest";

import { sumCentimes } from "./money";
import { computeStatement, latePenalty, type StatementInstallment } from "./statement";

const off = { monthlyRateBp: 0, graceDays: 0, capBp: 1_000 };

const schedule: StatementInstallment[] = [
  { position: 1, label: "Réservation", amount: 2_000_000_00n, dueOn: "2026-01-10" },
  { position: 2, label: "Fondations", amount: 3_000_000_00n, dueOn: "2026-06-30" },
  { position: 3, label: "12 mois", amount: 1_000_000_00n, dueOn: "2026-03-01" },
  { position: 4, label: "Gros œuvre", amount: 4_000_000_00n, dueOn: null },
];

describe("computeStatement", () => {
  it("applies payments oldest due first, unknown dates last", () => {
    const s = computeStatement(schedule, 2_500_000_00n, "2026-04-15", off);
    expect(s.lines.map((l) => [l.position, l.paid, l.remaining, l.state])).toEqual([
      [1, 2_000_000_00n, 0n, "paid"],
      [3, 500_000_00n, 500_000_00n, "overdue"],
      [2, 0n, 3_000_000_00n, "upcoming"],
      [4, 0n, 4_000_000_00n, "pending"],
    ]);
    expect(s).toMatchObject({
      price: 10_000_000_00n,
      paid: 2_500_000_00n,
      remaining: 7_500_000_00n,
      due: 500_000_00n,
      overdue: 500_000_00n,
      advance: 0n,
    });
    expect(s.lines[1]?.daysLate).toBe(45);
  });

  it("shows money paid beyond what is due as an advance on the next installments", () => {
    const s = computeStatement(schedule, 4_000_000_00n, "2026-04-15", off);
    expect(s.due).toBe(0n);
    expect(s.advance).toBe(1_000_000_00n);
    expect(s.lines.find((l) => l.position === 2)).toMatchObject({
      paid: 1_000_000_00n,
      state: "upcoming",
    });
  });

  it("marks an installment due today as due, not overdue", () => {
    const s = computeStatement(schedule, 0n, "2026-01-10", off);
    expect(s.lines[0]?.state).toBe("due");
    expect(s.due).toBe(2_000_000_00n);
    expect(s.overdue).toBe(0n);
  });

  it("is fully paid when payments reach the price", () => {
    const s = computeStatement(schedule, 10_000_000_00n, "2026-04-15", off);
    expect(s.lines.every((l) => l.state === "paid")).toBe(true);
    expect(s.remaining).toBe(0n);
    expect(sumCentimes(s.lines.map((l) => l.paid))).toBe(s.price);
  });
});

describe("late penalties", () => {
  const rules = { monthlyRateBp: 100, graceDays: 15, capBp: 1_000 };

  it("accrue per month of delay after the grace period, capped, never when off", () => {
    // 1 % per month on 500 000 DA, 45 days late, 15 grace → 30 days → 5 000 DA.
    expect(latePenalty(500_000_00n, 1_000_000_00n, 45, rules)).toBe(5_000_00n);
    expect(latePenalty(500_000_00n, 1_000_000_00n, 15, rules)).toBe(0n);
    // Capped at 10 % of the installment.
    expect(latePenalty(1_000_000_00n, 1_000_000_00n, 3_000, rules)).toBe(100_000_00n);
    expect(latePenalty(500_000_00n, 1_000_000_00n, 400, off)).toBe(0n);
  });

  it("are summed on the statement", () => {
    const s = computeStatement(schedule, 2_500_000_00n, "2026-04-15", rules);
    expect(s.lines.find((l) => l.position === 3)?.penalty).toBe(5_000_00n);
    expect(s.penalties).toBe(5_000_00n);
  });
});
