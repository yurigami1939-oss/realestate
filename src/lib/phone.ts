/**
 * Phone numbers (CLAUDE.md §8): stored E.164 ("+213550123456"), typed and shown the national
 * way for Algeria ("0550 12 34 56"), internationally for other countries (diaspora buyers).
 */
import { parsePhoneNumberFromString } from "libphonenumber-js";

export const DEFAULT_COUNTRY = "DZ";

/** E.164 form of a valid number typed as "0550 12 34 56", "+213 …" or "00213 …"; else null. */
export function normalizePhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), DEFAULT_COUNTRY);
  return parsed?.isValid() ? parsed.number : null;
}

/** "0550 12 34 56" for Algerian numbers, "+33 6 12 34 56 78" otherwise. */
export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === DEFAULT_COUNTRY
    ? parsed.formatNational()
    : parsed.formatInternational();
}

/** `tel:` link target. */
export const phoneHref = (e164: string) => `tel:${e164}`;

/** wa.me link target (digits only, no plus). */
export const whatsappHref = (e164: string) => `https://wa.me/${e164.replace(/\D/g, "")}`;

/**
 * Digits to look for in stored E.164 numbers when someone searches "0550 12…":
 * the national prefix (0, 213, 00213) is dropped. Null when fewer than 3 digits remain.
 */
export function phoneSearchDigits(query: string): string | null {
  const digits = query.replace(/\D/g, "").replace(/^(00213|213|0)/, "");
  return digits.length >= 3 ? digits : null;
}
