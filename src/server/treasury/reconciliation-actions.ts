"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  applySuggestions,
  bookStatementLine,
  deleteStatement,
  dismissStatementLine,
  matchStatementLine,
  restoreStatementLine,
  unmatchStatementLine,
} from "./reconciliation";
import {
  applySuggestionsSchema,
  bookStatementLineSchema,
  deleteStatementSchema,
  dismissStatementLineSchema,
  matchStatementLineSchema,
  statementLineSchema,
} from "./schemas";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/treasury", "layout");
    return result;
  });
}

const rights = { permission: "treasury:update" } as const;

export const matchStatementLineAction = defineAction(
  { input: matchStatementLineSchema, ...rights },
  (input, ctx) => mutation(() => matchStatementLine(ctx, input)),
);
export const applySuggestionsAction = defineAction(
  { input: applySuggestionsSchema, ...rights },
  (input, ctx) => mutation(() => applySuggestions(ctx, input)),
);
export const unmatchStatementLineAction = defineAction(
  { input: statementLineSchema, ...rights },
  (input, ctx) => mutation(() => unmatchStatementLine(ctx, input)),
);
export const bookStatementLineAction = defineAction(
  { input: bookStatementLineSchema, ...rights },
  (input, ctx) => mutation(() => bookStatementLine(ctx, input)),
);
export const dismissStatementLineAction = defineAction(
  { input: dismissStatementLineSchema, ...rights },
  (input, ctx) => mutation(() => dismissStatementLine(ctx, input)),
);
export const restoreStatementLineAction = defineAction(
  { input: statementLineSchema, ...rights },
  (input, ctx) => mutation(() => restoreStatementLine(ctx, input)),
);
export const deleteStatementAction = defineAction(
  { input: deleteStatementSchema, ...rights },
  (input, ctx) => mutation(() => deleteStatement(ctx, input)),
);
