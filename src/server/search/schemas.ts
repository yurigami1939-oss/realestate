import { z } from "zod";

/** What the command palette searches for: two characters at least. */
export const searchSchema = z.object({ q: z.string().trim().min(2).max(60) });
