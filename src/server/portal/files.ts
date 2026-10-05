import "server-only";

import type { Tx } from "@/db/client";

import { isPortalSale } from "./sales";

/**
 * Whether a portal account may download a stored file: only the documents of its own records
 * (CLAUDE.md §5). Every document of a sale is filed under the sale (sheet, receipts, payment
 * calls, reminder letters, signed scans), so a buyer reads all of them.
 */
export async function portalCanRead(
  tx: Tx,
  userId: string,
  stored: { id: string; entityType: string; entityId: string },
): Promise<boolean> {
  switch (stored.entityType) {
    case "reservation":
      return isPortalSale(tx, userId, stored.entityId);
    default:
      return false;
  }
}
