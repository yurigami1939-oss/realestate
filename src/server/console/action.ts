import "server-only";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { AppError, err, ok, type Result } from "@/lib/result";

import { getOperatorCtx, type Operator } from "./guard";

/**
 * Server Action of the console (CLAUDE.console.md §9): parse input → the operator (two-factor
 * enrolled) → handler → Result. Never a tenant context.
 */
export function defineConsoleAction<S extends z.ZodType, T>(
  config: { input: S },
  handler: (input: z.output<S>, ctx: Operator) => Promise<T>,
): (input: z.input<S>) => Promise<Result<T>> {
  return async (raw) => {
    try {
      const parsed = config.input.safeParse(raw);
      if (!parsed.success) {
        const { fieldErrors } = z.flattenError(parsed.error);
        return err(
          new AppError("VALIDATION", "errors.VALIDATION", {
            fieldErrors: fieldErrors as Record<string, string[]>,
          }),
        );
      }
      return ok(await handler(parsed.data, await getOperatorCtx()));
    } catch (error) {
      unstable_rethrow(error);
      if (error instanceof AppError) return err(error);
      console.error("[console action] unexpected error", error);
      return err(new AppError("UNEXPECTED"));
    }
  };
}
