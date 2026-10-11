import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { project, unit } from "@/db/schema";
import { AppError } from "@/lib/result";

/**
 * Buildings managed for third parties (CLAUDE.md §7 Residence charges): a project flagged
 * `third_party` is a building the organization only runs as syndic. It is delivered, its units
 * start delivered and nothing of the sales side (prices, plans, quotations, construction, costs)
 * reaches it.
 */
export const forSale = eq(project.thirdParty, false);

export const thirdPartyRefused = () => new AppError("CONFLICT", "inventory.errors.thirdParty");

/** Whether a live project is a third party's building (false when it does not exist). */
export async function isThirdPartyProject(tx: Tx, projectId: string): Promise<boolean> {
  const [row] = await tx
    .select({ thirdParty: project.thirdParty })
    .from(project)
    .where(and(eq(project.id, projectId), isNull(project.deletedAt)));
  return row?.thirdParty ?? false;
}

/** Refuses a sales-side action on a third party's building. */
export async function assertSaleProject(tx: Tx, projectId: string) {
  if (await isThirdPartyProject(tx, projectId)) throw thirdPartyRefused();
}

/** Refuses a sales-side action on a unit of a third party's building. */
export async function assertSaleUnit(tx: Tx, unitId: string) {
  const [row] = await tx
    .select({ thirdParty: project.thirdParty })
    .from(unit)
    .innerJoin(project, eq(project.id, unit.projectId))
    .where(eq(unit.id, unitId));
  if (row?.thirdParty) throw thirdPartyRefused();
}
