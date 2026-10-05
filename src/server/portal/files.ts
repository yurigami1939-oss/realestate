import "server-only";

import type { Tx } from "@/db/client";

import { portalCanReadResidenceFile } from "./residences";
import { isPortalReport, isPortalSale } from "./sales";

/**
 * Whether a portal account may download a stored file: only the documents of its own records
 * (CLAUDE.md §5). Every document of a sale is filed under the sale (sheet, receipts, payment
 * calls, reminder letters, signed scans), so a buyer reads all of them; residence documents are
 * checked one by one (a co-owner's own calls, receipts and letters, its residences' assembly
 * papers, published notices); site photos of the published reports of its projects.
 */
export async function portalCanRead(
  tx: Tx,
  userId: string,
  stored: { id: string; entityType: string; entityId: string },
): Promise<boolean> {
  switch (stored.entityType) {
    case "reservation":
      return isPortalSale(tx, userId, stored.entityId);
    case "residence":
      return portalCanReadResidenceFile(tx, userId, stored.id);
    case "construction_report":
      return isPortalReport(tx, userId, stored.entityId);
    default:
      return false;
  }
}
