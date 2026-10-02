import "server-only";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import type { Permission } from "@/lib/permissions";
import { AppError, err, ok, type Result } from "@/lib/result";

import { assertCan, getTenantCtx, type TenantCtx } from "./auth/session";

type ActionConfig<S extends z.ZodType> = {
  input: S;
  /** Checked before the handler; services still assert their own permissions. */
  permission?: Permission;
};

/**
 * Builds a Server Action (CLAUDE.md §5 Mutations):
 * parse input → resolve tenant context → check permission → run handler → Result.
 * Never throws to the client except Next.js control flow (redirect, notFound).
 *
 * @example
 * export const inviteMemberAction = defineAction(
 *   { input: inviteMemberSchema, permission: "invitation:create" },
 *   async (input, ctx) => inviteMember(ctx, input),
 * );
 */
export function defineAction<S extends z.ZodType, T>(
  config: ActionConfig<S>,
  handler: (input: z.output<S>, ctx: TenantCtx) => Promise<T>,
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
      const ctx = await getTenantCtx();
      if (config.permission) assertCan(ctx, config.permission);
      return ok(await handler(parsed.data, ctx));
    } catch (error) {
      unstable_rethrow(error);
      if (error instanceof AppError) return err(error);
      console.error("[action] unexpected error", error);
      return err(new AppError("UNEXPECTED"));
    }
  };
}
