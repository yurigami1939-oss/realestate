/**
 * Demo figures for the buyers' estimated acquisition costs printed on quotations (CLAUDE.md §7
 * Payment plans & quotations): a notary's scale by tranches, VAT on the fees, registration and
 * land registry duties and fixed costs, typed as an example — a real promoter types its
 * notary's figures.
 */
import type { TenantCtx } from "@/server/auth/session";
import { acquisitionCostsSchema } from "@/server/organizations/schemas";
import { saveAcquisitionCosts } from "@/server/organizations/settings";

export async function seedAcquisitionCosts(owner: TenantCtx) {
  await saveAcquisitionCosts(
    owner,
    acquisitionCostsSchema.parse({
      tranches: [
        { upTo: "2 000 000", rate: "2" },
        { upTo: "5 000 000", rate: "1,5" },
        { upTo: "", rate: "1" },
      ],
      notaryVat: "19",
      registration: "5",
      publication: "1",
      fixedFees: "15 000",
    }),
  );
}
