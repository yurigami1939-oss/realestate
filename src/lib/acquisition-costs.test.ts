import { describe, expect, it } from "vitest";

import {
  acquisitionCostSettings,
  estimateAcquisitionCosts,
  notaryFees,
  readAcquisitionCosts,
  storeAcquisitionCostSettings,
  storeAcquisitionCosts,
} from "./acquisition-costs";

const DA = (dinars: number) => BigInt(dinars) * 100n;

describe("acquisition costs", () => {
  const settings = acquisitionCostSettings({
    // Stored in any order: read sorted by ceiling, the open tranche last.
    notaryTranches: [
      { upTo: null, rateBp: 100 },
      { upTo: DA(2_000_000).toString(), rateBp: 200 },
      { upTo: DA(5_000_000).toString(), rateBp: 150 },
    ],
    notaryVatBp: 1900,
    registrationBp: 500,
    publicationBp: 100,
    fixedFees: DA(15_000).toString(),
  });

  it("applies each tranche's rate to the part of the price within it", () => {
    expect(settings.notaryTranches.map((t) => t.upTo)).toEqual([
      DA(2_000_000),
      DA(5_000_000),
      null,
    ]);
    // 2 % of 2 M + 1,5 % of 3 M + 1 % of 3 M.
    expect(notaryFees(DA(8_000_000), settings.notaryTranches)).toBe(DA(40_000 + 45_000 + 30_000));
    // Within the first tranche only.
    expect(notaryFees(DA(1_500_000), settings.notaryTranches)).toBe(DA(30_000));
    // Half-up to the centime.
    expect(notaryFees(1n, [{ upTo: null, rateBp: 5000 }])).toBe(1n);
    // Without an open tranche, the price above the last ceiling bears no fee.
    expect(notaryFees(DA(3_000_000), [{ upTo: DA(1_000_000), rateBp: 100 }])).toBe(DA(10_000));
    expect(notaryFees(0n, settings.notaryTranches)).toBe(0n);
  });

  it("estimates every cost of a price, and nothing when nothing is set", () => {
    const costs = estimateAcquisitionCosts(DA(8_000_000), settings);
    expect(costs).toEqual({
      notaryFees: DA(115_000),
      notaryVat: DA(21_850),
      registration: DA(400_000),
      publication: DA(80_000),
      fixedFees: DA(15_000),
      total: DA(115_000 + 21_850 + 400_000 + 80_000 + 15_000),
    });
    expect(costs && readAcquisitionCosts(storeAcquisitionCosts(costs))).toEqual(costs);
    expect(estimateAcquisitionCosts(DA(8_000_000), acquisitionCostSettings({}))).toBeNull();
    expect(acquisitionCostSettings(storeAcquisitionCostSettings(settings))).toEqual(settings);
  });
});
