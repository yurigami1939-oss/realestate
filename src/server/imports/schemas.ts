/** Isomorphic: the data imports (reprise de données) and their options. */
import { z } from "zod";

/** In the order a promoter brings its data in: units, buyers, then their sales; residences. */
export const importKinds = [
  "units",
  "buyers",
  "sales",
  "residents",
  "leads",
  "bank_statement",
] as const;
export type ImportKind = (typeof importKinds)[number];

/** Sent with the file: the project (units), residence (residents) or account (statement), and whether to write. */
export const importOptionsSchema = z.object({
  project: z.uuid().optional().catch(undefined),
  residence: z.uuid().optional().catch(undefined),
  /** A bank statement's account. */
  account: z.uuid().optional().catch(undefined),
  commit: z
    .enum(["0", "1"])
    .optional()
    .catch(undefined)
    .transform((v) => v === "1"),
});

/** The largest file accepted (an .xlsx of thousands of rows stays far below). */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** What the server answers: what would be (or was) created, what blocks, what is left aside. */
export type ImportReport = {
  kind: ImportKind;
  committed: boolean;
  counts: Record<string, number>;
  issues: ImportIssueView[];
  warnings: ImportIssueView[];
};

export type ImportIssueView = {
  sheet: { fr: string; ar: string };
  row: number | null;
  column: { fr: string; ar: string } | null;
  messageKey: string;
  values?: Record<string, string | number>;
};
