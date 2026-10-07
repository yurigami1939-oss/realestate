"use client";

import { useLocale } from "next-intl";

import { wilayas } from "@/lib/wilayas";

/** The id of the wilayas' suggestions, for an input's `list`. */
export const WILAYA_OPTIONS = "wilaya-options";

/** The 58 wilayas as suggestions (the field stays free text), in the member's language. */
export function WilayaOptions() {
  const locale = useLocale() === "ar" ? "ar" : "fr";
  return (
    <datalist id={WILAYA_OPTIONS}>
      {wilayas.map((w) => (
        <option key={w.code} value={w[locale]}>
          {`${w.code} · ${locale === "ar" ? w.fr : w.ar}`}
        </option>
      ))}
    </datalist>
  );
}
