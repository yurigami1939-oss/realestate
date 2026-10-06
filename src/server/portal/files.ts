import "server-only";

import { eq } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { handover } from "@/db/schema";

import { portalScope } from "./context";
import { portalCanReadResidenceFile } from "./residences";
import { isPortalReport, isPortalSale } from "./sales";

/**
 * Whether a portal account may download a stored file: only the documents of its own records
 * (CLAUDE.md §5). Every document of a sale is filed under the sale (sheet, receipts, payment
 * calls, reminder letters, signed scans), so a buyer reads all of them; residence documents are
 * checked one by one (a co-owner's own calls, receipts and letters, its residences' assembly
 * papers, published notices); site photos of the published reports of its projects; the
 * delivery PVs of its sales.
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
    case "buyer": {
      // The documents of the account's own buyer files (sent by staff or from the portal).
      const { buyerIds } = await portalScope(tx, { userId });
      return buyerIds.includes(stored.entityId);
    }
    case "handover": {
      const [row] = await tx
        .select({ reservationId: handover.reservationId })
        .from(handover)
        .where(eq(handover.id, stored.entityId));
      return row !== undefined && isPortalSale(tx, userId, row.reservationId);
    }
    default:
      return false;
  }
}
