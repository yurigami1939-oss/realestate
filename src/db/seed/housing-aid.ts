/**
 * Demo LPA settings (CLAUDE.md §7 After the reservation): Les Terrasses de la Corniche is sold as
 * logement promotionnel aidé, with an SNMG, an income ceiling and CNL aid and subsidised rate
 * brackets typed as an example — a real promoter types the figures of the decrees in force.
 */
import { eq } from "drizzle-orm";

import { project } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { TenantCtx } from "@/server/auth/session";
import { housingAidSchema } from "@/server/housing-aid/schemas";
import { saveHousingAid } from "@/server/housing-aid/service";

export async function seedHousingAid(owner: TenantCtx, projectIds: Map<string, string>) {
  await saveHousingAid(
    owner,
    housingAidSchema.parse({
      snmg: "20 000",
      lpaMaxMultiple: "6",
      cnlBrackets: [
        { maxMultiple: "4", amount: "700 000" },
        { maxMultiple: "6", amount: "400 000" },
      ],
      rateBrackets: [
        { maxMultiple: "6", rate: "1" },
        { maxMultiple: "12", rate: "3" },
      ],
    }),
  );
  const corniche = projectIds.get("CORN");
  if (!corniche) throw new Error("seed: La Corniche missing");
  await withTenant(owner, (tx) =>
    tx.update(project).set({ housingProgram: "lpa" }).where(eq(project.id, corniche)),
  );
}
