import "server-only";

import type { Locale } from "@/i18n/locales";

/**
 * Who acts in the console (CLAUDE.console.md §9): an operator, or null for the console's jobs
 * and the seed. Operators' sign-in and `getOperatorCtx()` come with the console shell (step 5).
 */
export type OperatorCtx = {
  userId: string | null;
  name?: string;
  email?: string;
  locale?: Locale;
};

/** The console's jobs and the seed. */
export const systemOperator: OperatorCtx = { userId: null };
