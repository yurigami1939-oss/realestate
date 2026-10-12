import "server-only";

/**
 * Who acts in the console (CLAUDE.console.md §9): an operator, or null for the console's jobs
 * and the seed. Operators' sign-in and `getOperatorCtx()` come with the console shell (step 5).
 */
export type OperatorCtx = { userId: string | null };

/** The console's jobs and the seed. */
export const systemOperator: OperatorCtx = { userId: null };
