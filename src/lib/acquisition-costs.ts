import { applyRate, type Centimes } from "./money";

/**
 * A buyer's estimated acquisition costs (CLAUDE.md §7 Payment plans & quotations): the notary's
 * fees by tranches of the price, the VAT on them, the registration duty, the land registry
 * publication and fixed costs (stamps, copies) — at the organization's figures, set with its
 * notary; nothing legal is hard-coded. Indicative only: printed on quotations.
 */

/** A tranche of the notary's scale: its rate applies to the part of the price up to `upTo`. */
export type FeeTranche = { upTo: Centimes | null; rateBp: number };

export type AcquisitionCostSettings = {
  /** Sorted by ceiling; `upTo` null = the rest of the price. */
  notaryTranches: FeeTranche[];
  notaryVatBp: number;
  registrationBp: number;
  publicationBp: number;
  fixedFees: Centimes;
};

/** As kept in `organization_setting.acquisition_costs` (amounts as centime strings). */
export type StoredAcquisitionCostSettings = {
  notaryTranches?: { upTo: string | null; rateBp: number }[];
  notaryVatBp?: number;
  registrationBp?: number;
  publicationBp?: number;
  fixedFees?: string;
};

const byCeiling = (a: FeeTranche, b: FeeTranche) =>
  a.upTo === null ? 1 : b.upTo === null ? -1 : a.upTo < b.upTo ? -1 : a.upTo > b.upTo ? 1 : 0;

export function acquisitionCostSettings(
  stored: StoredAcquisitionCostSettings | null | undefined,
): AcquisitionCostSettings {
  return {
    notaryTranches: (stored?.notaryTranches ?? [])
      .map((t) => ({ upTo: t.upTo === null ? null : BigInt(t.upTo), rateBp: t.rateBp }))
      .sort(byCeiling),
    notaryVatBp: stored?.notaryVatBp ?? 0,
    registrationBp: stored?.registrationBp ?? 0,
    publicationBp: stored?.publicationBp ?? 0,
    fixedFees: BigInt(stored?.fixedFees ?? "0"),
  };
}

export function storeAcquisitionCostSettings(
  settings: AcquisitionCostSettings,
): StoredAcquisitionCostSettings {
  return {
    notaryTranches: [...settings.notaryTranches]
      .sort(byCeiling)
      .map((t) => ({ upTo: t.upTo === null ? null : t.upTo.toString(), rateBp: t.rateBp })),
    notaryVatBp: settings.notaryVatBp,
    registrationBp: settings.registrationBp,
    publicationBp: settings.publicationBp,
    fixedFees: settings.fixedFees.toString(),
  };
}

/** Whether the organization set anything to estimate (else quotations print nothing). */
export const hasAcquisitionCosts = (settings: AcquisitionCostSettings): boolean =>
  settings.notaryTranches.some((t) => t.rateBp > 0) ||
  settings.registrationBp > 0 ||
  settings.publicationBp > 0 ||
  settings.fixedFees > 0n;

export type AcquisitionCosts = {
  notaryFees: Centimes;
  notaryVat: Centimes;
  registration: Centimes;
  publication: Centimes;
  fixedFees: Centimes;
  /** Every cost; the price itself is not included. */
  total: Centimes;
};

/** The notary's fees: each tranche's rate on the part of the price within it (half-up). */
export function notaryFees(price: Centimes, tranches: readonly FeeTranche[]): Centimes {
  let fees = 0n;
  let floor = 0n;
  for (const tranche of [...tranches].sort(byCeiling)) {
    if (price <= floor) break;
    const ceiling = tranche.upTo === null || tranche.upTo > price ? price : tranche.upTo;
    if (ceiling > floor) fees += applyRate(ceiling - floor, tranche.rateBp);
    if (tranche.upTo === null) break;
    floor = tranche.upTo > floor ? tranche.upTo : floor;
  }
  return fees;
}

/** The estimate for a price (the net price of a quotation), null when nothing is set. */
export function estimateAcquisitionCosts(
  price: Centimes,
  settings: AcquisitionCostSettings,
): AcquisitionCosts | null {
  if (!hasAcquisitionCosts(settings)) return null;
  const fees = notaryFees(price, settings.notaryTranches);
  const costs = {
    notaryFees: fees,
    notaryVat: applyRate(fees, settings.notaryVatBp),
    registration: applyRate(price, settings.registrationBp),
    publication: applyRate(price, settings.publicationBp),
    fixedFees: settings.fixedFees,
  };
  return {
    ...costs,
    total:
      costs.notaryFees + costs.notaryVat + costs.registration + costs.publication + costs.fixedFees,
  };
}

/** An estimate as frozen on a quotation (centime strings). */
export type StoredAcquisitionCosts = Record<keyof AcquisitionCosts, string>;

export const storeAcquisitionCosts = (costs: AcquisitionCosts): StoredAcquisitionCosts => ({
  notaryFees: costs.notaryFees.toString(),
  notaryVat: costs.notaryVat.toString(),
  registration: costs.registration.toString(),
  publication: costs.publication.toString(),
  fixedFees: costs.fixedFees.toString(),
  total: costs.total.toString(),
});

export const readAcquisitionCosts = (stored: StoredAcquisitionCosts): AcquisitionCosts => ({
  notaryFees: BigInt(stored.notaryFees),
  notaryVat: BigInt(stored.notaryVat),
  registration: BigInt(stored.registration),
  publication: BigInt(stored.publication),
  fixedFees: BigInt(stored.fixedFees),
  total: BigInt(stored.total),
});
