/**
 * Isomorphic: shared by client forms and server code. Error messages are i18n keys.
 */
import { z } from "zod";

const email = z.email("validation.email").trim().toLowerCase();
const newPassword = z.string().min(10, "validation.passwordMin").max(128, "validation.tooLong");

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "validation.required"),
});

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "validation.required").max(120, "validation.tooLong"),
  email,
  password: newPassword,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({ password: newPassword });

export const organizationSlugSchema = z
  .string()
  .trim()
  .min(2, "validation.required")
  .max(60, "validation.tooLong")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "validation.slug");

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, "validation.required").max(120, "validation.tooLong"),
  slug: organizationSlugSchema,
  legalName: z.string().trim().max(200, "validation.tooLong").optional(),
});

/** "Promo El Bahdja" → "promo-el-bahdja" (accents stripped). */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
