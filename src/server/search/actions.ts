"use server";

import { defineAction } from "@/server/action";

import { searchRecords } from "./queries";
import { searchSchema } from "./schemas";

/** The command palette's records; each kind checks its own reading right. */
export const searchRecordsAction = defineAction({ input: searchSchema }, (input, ctx) =>
  searchRecords(ctx, input.q),
);
