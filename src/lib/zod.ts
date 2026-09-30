/**
 * Zod builders for form fields (isomorphic). Inputs are the strings a form produces;
 * outputs are typed values. Error messages are i18n keys (CLAUDE.md §8).
 */
import { z } from "zod";

import { parseDZD } from "./money";

const blankToNull = (value: string) => (value.trim() === "" ? null : value.trim());

export const requiredText = (max = 200) =>
  z.string().trim().min(1, "validation.required").max(max, "validation.tooLong");

/** "" → null. */
export const optionalText = (max = 500) =>
  z
    .string()
    .max(max, "validation.tooLong")
    .transform(blankToNull)
    .nullable()
    .optional()
    .transform((v) => v ?? null);

/** Short uppercase reference: "OLIV", "A", "A-03-12". */
export const codeText = (max = 20) =>
  z
    .string()
    .trim()
    .min(1, "validation.required")
    .max(max, "validation.tooLong")
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "validation.code")
    .transform((v) => v.toUpperCase());

export const intText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^-?\d+$/, "validation.integer")
    .transform(Number)
    .pipe(z.number().int().min(min, "validation.outOfRange").max(max, "validation.outOfRange"));

export const optionalIntText = (min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const v = raw?.trim() ?? "";
      if (v === "") return null;
      if (!/^-?\d+$/.test(v)) {
        ctx.addIssue({ code: "custom", message: "validation.integer" });
        return z.NEVER;
      }
      const n = Number(v);
      if (n < min || n > max) {
        ctx.addIssue({ code: "custom", message: "validation.outOfRange" });
        return z.NEVER;
      }
      return n;
    });

/** Area in m²: "85", "85,5", "85.50" → "85.50"-style decimal string for `numeric`; "" → null. */
export const optionalAreaText = () =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const v = raw?.trim() ?? "";
      if (v === "") return null;
      const normalized = v.replace(",", ".");
      if (!/^\d{1,8}(\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0) {
        ctx.addIssue({ code: "custom", message: "validation.area" });
        return z.NEVER;
      }
      return normalized;
    });

/** Amount in dinars as typed by a user ("1 250 000,50") → bigint centimes. */
export const moneyText = () =>
  z.string().transform((v, ctx) => {
    const parsed = parseDZD(v);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "validation.amount" });
      return z.NEVER;
    }
    return parsed;
  });

/** HTML date input value "YYYY-MM-DD"; "" → null. */
export const optionalDateText = () =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const v = raw?.trim() ?? "";
      if (v === "") return null;
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
      if (!valid) {
        ctx.addIssue({ code: "custom", message: "validation.date" });
        return z.NEVER;
      }
      return v;
    });

/** Select with an empty option: "" or missing → null. */
export const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : (v as T[number])));
