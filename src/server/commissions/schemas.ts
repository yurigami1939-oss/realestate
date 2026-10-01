/** Isomorphic: shared by the commissions page and its actions. */
import { z } from "zod";

import { commissionStatuses } from "@/lib/sales";
import { dateText, optionalPercentText } from "@/lib/zod";

export const COMMISSIONS_PAGE_SIZE = 50;

export const commissionListParams = z.object({
  status: z.enum(commissionStatuses).optional().catch(undefined),
  userId: z.uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type CommissionListParams = z.output<typeof commissionListParams>;

/** An earned commission was paid to the commercial. */
export const payCommissionSchema = z.object({
  commissionId: z.uuid(),
  paidOn: dateText(),
});

/** Rate per commercial (percent of the net price); "" = the company default (CLAUDE.md §12). */
export const commissionRatesSchema = z.object({
  rates: z.array(z.object({ userId: z.uuid(), rate: optionalPercentText(0, 20) })).max(200),
});
