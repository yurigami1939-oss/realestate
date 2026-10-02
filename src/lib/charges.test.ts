import { describe, expect, it } from "vitest";

import {
  annualReserve,
  buildChargeCalls,
  type ChargeCategory,
  categoryWeights,
  periodLabels,
  periodPart,
} from "./charges";
import { sumCentimes } from "./money";

const units = [
  { unitId: "a1", buildingId: "A", share: 3000 },
  { unitId: "a2", buildingId: "A", share: 2000 },
  { unitId: "b1", buildingId: "B", share: 5000 },
  { unitId: "shop", buildingId: "B", share: 0 },
];

const category = (overrides: Partial<ChargeCategory>): ChargeCategory => ({
  id: "c",
  name: "Nettoyage",
  nameAr: "التنظيف",
  key: "share",
  weighting: "share",
  buildingId: null,
  unitIds: [],
  ...overrides,
});

const reserveLabel = { fr: "Fonds de réserve", ar: "صندوق الاحتياط" };

describe("charge distribution", () => {
  it("weighs units by key", () => {
    expect(categoryWeights(category({ key: "share" }), units).map((w) => w.weight)).toEqual([
      3000n,
      2000n,
      5000n,
      0n,
    ]);
    expect(categoryWeights(category({ key: "equal" }), units).map((w) => w.weight)).toEqual([
      1n,
      1n,
      1n,
      1n,
    ]);
    expect(categoryWeights(category({ key: "per_building", buildingId: "A" }), units)).toEqual([
      { unitId: "a1", weight: 3000n },
      { unitId: "a2", weight: 2000n },
    ]);
    expect(
      categoryWeights(
        category({ key: "custom", weighting: "equal", unitIds: ["a2", "shop"] }),
        units,
      ),
    ).toEqual([
      { unitId: "a2", weight: 1n },
      { unitId: "shop", weight: 1n },
    ]);
  });

  it("calls the annual amount in equal parts that sum to it", () => {
    const annual = 100_000_01n;
    const parts = [1, 2, 3, 4].map((i) => periodPart(annual, "quarterly", i));
    expect(parts).toEqual([25_000_01n, 25_000_00n, 25_000_00n, 25_000_00n]);
    expect(sumCentimes(parts)).toBe(annual);
    expect(periodPart(annual, "yearly", 1)).toBe(annual);
    expect(() => periodPart(annual, "quarterly", 5)).toThrow(RangeError);
    expect(annualReserve(1_200_000_00n, 500)).toBe(60_000_00n);
  });

  it("builds one call per unit with its lines and the reserve fund", () => {
    const { calls, total, reserve, problems } = buildChargeCalls({
      units,
      categories: [
        { ...category({ id: "clean", key: "share" }), annual: 400_000_00n },
        {
          ...category({ id: "lift", name: "Ascenseur A", key: "per_building", buildingId: "A" }),
          annual: 200_000_00n,
        },
        {
          ...category({ id: "guard", name: "Gardiennage", key: "equal" }),
          annual: 80_000_00n,
        },
      ],
      frequency: "quarterly",
      periodIndex: 2,
      reserveFundBp: 1000,
      reserveLabel,
    });
    expect(problems).toEqual([]);
    // Quarter: 100 000 + 50 000 + 20 000 = 170 000 DA, reserve 10 % of 680 000 / 4 = 17 000 DA.
    expect(total).toBe(187_000_00n);
    expect(reserve).toBe(17_000_00n);
    expect(sumCentimes(calls.map((c) => c.amount))).toBe(total);
    const a1 = calls.find((c) => c.unitId === "a1");
    expect(a1?.lines).toEqual([
      { categoryId: "clean", label: "Nettoyage", labelAr: "التنظيف", amount: 30_000_00n },
      { categoryId: "lift", label: "Ascenseur A", labelAr: "التنظيف", amount: 30_000_00n },
      { categoryId: "guard", label: "Gardiennage", labelAr: "التنظيف", amount: 5_000_00n },
      { categoryId: null, label: "Fonds de réserve", labelAr: "صندوق الاحتياط", amount: 5_100_00n },
    ]);
    expect(a1?.reserve).toBe(5_100_00n);
    // The shop has no tantièmes: it only bears the equal-split guarding.
    expect(calls.find((c) => c.unitId === "shop")?.lines.map((l) => l.categoryId)).toEqual([
      "guard",
    ]);
  });

  it("reports parts that cannot be split", () => {
    const { problems, calls } = buildChargeCalls({
      units,
      categories: [
        {
          ...category({ id: "lift", key: "per_building", buildingId: "C" }),
          annual: 100_00n,
        },
        { ...category({ id: "shopOnly", key: "custom", unitIds: ["shop"] }), annual: 100_00n },
        { ...category({ id: "empty", key: "share" }), annual: 0n },
      ],
      frequency: "yearly",
      periodIndex: 1,
      reserveFundBp: 0,
      reserveLabel,
    });
    expect(problems).toEqual([
      { categoryId: "lift", reason: "noUnits" },
      { categoryId: "shopOnly", reason: "noShares" },
    ]);
    expect(calls).toEqual([]);
  });

  it("names the periods in both languages", () => {
    expect(periodLabels("monthly", 2026, 2)).toEqual({ fr: "Février 2026", ar: "فيفري 2026" });
    expect(periodLabels("quarterly", 2026, 1)).toEqual({
      fr: "1er trimestre 2026",
      ar: "الثلاثي الأول 2026",
    });
    expect(periodLabels("half_yearly", 2026, 2).fr).toBe("2e semestre 2026");
    expect(periodLabels("yearly", 2027, 1)).toEqual({ fr: "Année 2027", ar: "سنة 2027" });
  });
});
