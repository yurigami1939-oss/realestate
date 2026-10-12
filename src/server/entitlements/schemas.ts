import { z } from "zod";

import { modules } from "@/lib/modules";

/** The gérant switches one entitled module on or off (CLAUDE.console.md §5). */
export const setModuleSchema = z.object({ module: z.enum(modules), on: z.boolean() });
