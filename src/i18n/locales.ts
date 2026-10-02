/** Supported UI locales. French is the default; Arabic is right-to-left. */
export const locales = ["fr", "ar"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "fr";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (locales as readonly string[]).includes(value);

export const localeDirection = (locale: Locale): "ltr" | "rtl" => (locale === "ar" ? "rtl" : "ltr");

/** Narrows a route param. Unknown values already 404 in the [locale] layout. */
export const toLocale = (value: string): Locale => (isLocale(value) ? value : defaultLocale);
