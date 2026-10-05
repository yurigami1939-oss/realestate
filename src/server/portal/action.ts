import "server-only";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { AppError, err, ok, type Result } from "@/lib/result";

import { getPortalCtx, type PortalCtx } from "./context";

/**
 * Server Action of the portal (like `defineAction`, CLAUDE.md §5 Mutations): parse input →
 * resolve the portal account (never a staff context) → handler → Result.
 */
export function definePortalAction<S extends z.ZodType, T>(
  input: S,
  handler: (input: z.output<S>, ctx: PortalCtx) => Promise<T>,
): (raw: z.input<S>) => Promise<Result<T>> {
  return async (raw) => {
    try {
      const parsed = input.safeParse(raw);
      if (!parsed.success) {
        const { fieldErrors } = z.flattenError(parsed.error);
        return err(
          new AppError("VALIDATION", "errors.VALIDATION", {
            fieldErrors: fieldErrors as Record<string, string[]>,
          }),
        );
      }
      return ok(await handler(parsed.data, await getPortalCtx()));
    } catch (error) {
      unstable_rethrow(error);
      if (error instanceof AppError) return err(error);
      console.error("[portal action] unexpected error", error);
      return err(new AppError("UNEXPECTED"));
    }
  };
}
