import "server-only";

import { eq } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { organizationSetting } from "@/db/schema";
import { type TaxSettings, taxSettings } from "@/lib/accounting";

/** The organization's tax settings, saved over the defaults (CLAUDE.md §7 Treasury). */
export async function loadTaxSettings(tx: Tx, orgId: string): Promise<TaxSettings> {
  const [row] = await tx
    .select({ tax: organizationSetting.taxSettings })
    .from(organizationSetting)
    .where(eq(organizationSetting.organizationId, orgId));
  return taxSettings(row?.tax ?? null);
}
