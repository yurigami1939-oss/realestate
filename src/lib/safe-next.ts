import { locales } from "@/i18n/locales";

/**
 * Sanitizes a post-login redirect target: only same-site paths, returned without a locale
 * prefix (the locale-aware router adds it). Anything else falls back to `fallback`.
 */
export function safeNext(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//"))
    return fallback;
  if (value.includes("\\") || /[\u0000-\u001f]/.test(value)) return fallback;
  const localePrefix = new RegExp(`^/(${locales.join("|")})(?=/|$)`);
  const path = value.replace(localePrefix, "") || "/";
  return path === "/" ? fallback : path;
}
