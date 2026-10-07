/** Isomorphic: individuals' rights under Loi 18-07 (CLAUDE.md §7 Personal data). */
import { z } from "zod";

import { requiredText } from "@/lib/zod";

/** A prospect erased at their request (or past its keeping period), with the reason. */
export const anonymizeLeadSchema = z.object({ leadId: z.uuid(), reason: requiredText(300) });
