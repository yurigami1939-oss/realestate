import "server-only";

import type { z } from "zod";

import type { Tx } from "@/db/client";

import type { ImportColumn, ImportIssue, Label } from "./sheets";

/**
 * A checked import: what it would create (`counts`), the problems that block it (`issues`),
 * the rows it leaves aside (`warnings`, e.g. a unit already there), and the writes to run in
 * one transaction once nothing blocks.
 */
export type ImportPlan = {
  counts: Record<string, number>;
  issues: ImportIssue[];
  warnings: ImportIssue[];
  apply: (tx: Tx) => Promise<void>;
};

/** A sheet of a template: its name, columns and an example row, in both languages. */
export type TemplateSheet = {
  name: { fr: string; ar: string };
  columns: (ImportColumn & { help: { fr: string; ar: string } })[];
  example: Record<string, string | number>;
};

/** Reports issues on the rows of one sheet, columns named by their key. */
export function issuesOf(def: TemplateSheet, issues: ImportIssue[]) {
  const label = (key: string | null): Label | null => {
    const column = def.columns.find((c) => c.key === key);
    return column ? { fr: column.fr, ar: column.ar } : null;
  };
  return {
    at: (
      row: number | null,
      key: string | null,
      messageKey: string,
      values?: Record<string, string | number>,
    ) => issues.push({ sheet: def.name, row, column: label(key), messageKey, values }),
    /** Zod issues of a row → issues on its columns (schema field → column key). */
    zod: (row: number, error: z.ZodError, fieldToColumn: Record<string, string> = {}) => {
      for (const issue of error.issues) {
        const field = String(issue.path[0] ?? "");
        issues.push({
          sheet: def.name,
          row,
          column: label(fieldToColumn[field] ?? field),
          messageKey: issue.message.includes(".") ? issue.message : "errors.VALIDATION",
        });
      }
    },
  };
}

/** The reason written in histories for what an import changes. */
export const IMPORT_REASON = "Reprise de données";
