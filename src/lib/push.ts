import { whatsappKinds } from "./whatsapp";

/**
 * Push notifications (CLAUDE.md §7 Push notifications): what is sent to the devices residents
 * and staff turned them on for.
 */

/** To portal accounts: the WhatsApp notifications, and answers to what they asked. */
export const residentPushKinds = [
  ...whatsappKinds,
  "request_answered",
  "ticket_status",
  "claim_closed",
  "room_decided",
  "visitor_arrived",
] as const;

/** To staff: what waits for them. */
export const staffPushKinds = [
  "lead_assigned",
  "discount_requested",
  "discount_decided",
  "portal_request",
  "portal_ticket",
  "warranty_claim",
  "room_requested",
] as const;

export const pushKinds = [...residentPushKinds, ...staffPushKinds, "test"] as const;
export type PushKind = (typeof pushKinds)[number];

/** A parameter of a notification's text: one value, or one per language (amounts). */
export type PushParam = string | { fr: string; ar: string };
export type PushParams = Record<string, PushParam>;

/**
 * Hosts of the push services browsers subscribe with: Chrome, Edge and Android (FCM), Firefox
 * (Mozilla), Safari and iOS (Apple), Windows (WNS). Anything else is refused, so a subscription
 * can never make the server call an address of its choosing.
 */
const pushServiceHosts = [
  "fcm.googleapis.com",
  ".push.services.mozilla.com",
  ".push.apple.com",
  ".notify.windows.com",
] as const;

export function isPushServiceUrl(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return pushServiceHosts.some((h) => (h.startsWith(".") ? host.endsWith(h) : host === h));
}

/** A device's name from its browser's user agent (« Chrome · Android »), null when unknown. */
export function deviceLabel(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const os = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent)
      ? "iOS"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Linux|CrOS/.test(userAgent)
            ? "Linux"
            : null;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(userAgent)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : null;
  const parts = [browser, os].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
