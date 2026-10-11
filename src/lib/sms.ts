/**
 * SMS notifications (CLAUDE.md §7 SMS): the same notifications as WhatsApp, sent as text
 * messages through the promoter's own SMS account (an operator's « SMS Pro » offer — Mobilis,
 * Djezzy, Ooredoo — or an aggregator) to the people WhatsApp does not reach. Isomorphic.
 */
import type { WhatsappKind, WhatsappLanguage } from "./whatsapp";
import { whatsappTemplates } from "./whatsapp";

export const smsProviders = ["mobilis", "djezzy", "ooredoo", "other"] as const;
export type SmsProvider = (typeof smsProviders)[number];

/** queued → sent, or failed (refused by the gateway, or unreachable after the retries). */
export const smsStatuses = ["queued", "sent", "failed"] as const;
export type SmsStatus = (typeof smsStatuses)[number];

/** Alphanumeric sender name (« nom d'expéditeur »), as the operator registers it: 3–11 chars. */
export const SMS_SENDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .-]{1,9}[A-Za-z0-9]$/;

/**
 * The mobile number an SMS goes to (E.164), or null: Algerian landlines (only mobiles 5, 6, 7
 * receive SMS) and malformed numbers. Foreign mobiles are kept.
 */
export function smsNumber(phone: string | null | undefined): string | null {
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  if (phone.startsWith("+213") && !/^\+213[567]\d{8}$/.test(phone)) return null;
  return phone;
}

/** The notification's text in a language: its WhatsApp template with the parameters filled. */
export function smsText(kind: WhatsappKind, language: WhatsappLanguage, params: string[]): string {
  return whatsappTemplates[kind][language].replace(
    /\{\{(\d+)\}\}/g,
    (_, n: string) => params[Number(n) - 1] ?? "",
  );
}

// The GSM 03.38 alphabet (basic set and the extension table, which counts twice).
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€";

/**
 * How many messages (segments) a text takes: GSM 7-bit texts 160 characters, or 153 per part
 * once split; anything else (Arabic, ’, «…) is sent in UCS-2: 70, or 67 per part.
 */
export function smsSegments(text: string): { encoding: "gsm" | "ucs2"; segments: number } {
  let septets = 0;
  let gsm = true;
  for (const char of text) {
    if (GSM_BASIC.includes(char)) septets += 1;
    else if (GSM_EXTENDED.includes(char)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) return { encoding: "gsm", segments: septets <= 160 ? 1 : Math.ceil(septets / 153) };
  const units = [...text].reduce(
    (sum, char) => sum + ((char.codePointAt(0) ?? 0) > 0xffff ? 2 : 1),
    0,
  );
  return { encoding: "ucs2", segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

// Characters outside the GSM alphabet that have a close GSM spelling (French texts, amounts).
const GSM_SPELLINGS: Record<string, string> = {
  "\u00a0": " ",
  "\u202f": " ",
  "\u2009": " ",
  ç: "c",
  â: "a",
  ê: "e",
  ë: "e",
  î: "i",
  ï: "i",
  ô: "o",
  û: "u",
  ÿ: "y",
  À: "A",
  Â: "A",
  È: "E",
  Ê: "E",
  Ë: "E",
  Î: "I",
  Ï: "I",
  Ô: "O",
  Û: "U",
  Ù: "U",
  "°": "o",
  "’": "'",
  "‘": "'",
  "«": '"',
  "»": '"',
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
};

/**
 * The text as sent: French letters and signs outside the GSM alphabet respelled (« reçu » →
 * « recu », no-break spaces → spaces) so a French message stays in 160-character parts; an
 * Arabic text is sent as is (UCS-2).
 */
export function smsGsmText(text: string): string {
  return [...text].map((char) => GSM_SPELLINGS[char] ?? char).join("");
}
