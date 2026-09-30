import "server-only";

import { createTranslator } from "next-intl";

import type { EmailMessage } from "@/jobs/queues";

import ar from "../../../messages/ar.json";
import fr from "../../../messages/fr.json";

const catalogs = { fr, ar } as const;
type EmailKind = "invitation" | "resetPassword";
type Values = Record<string, string>;

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

function section(locale: "fr" | "ar", kind: EmailKind, values: Values, url: string) {
  const t = createTranslator({ locale, messages: catalogs[locale], namespace: `emails.${kind}` });
  const lines = [t("body", values), t("notice")];
  const dir = locale === "ar" ? "rtl" : "ltr";
  const html = `
    <div dir="${dir}" lang="${locale}" style="text-align:${dir === "rtl" ? "right" : "left"};margin:0 0 32px">
      ${lines.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`).join("")}
      <p style="margin:20px 0"><a href="${escapeHtml(url)}" style="background:#171717;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("cta"))}</a></p>
    </div>`;
  const text = `${lines.join("\n")}\n${t("cta")}: ${url}`;
  return { subject: t("subject", values), html, text };
}

/** One email, French then Arabic: the recipient's language is not known yet. */
function bilingual(kind: EmailKind, to: string, values: Values, url: string): EmailMessage {
  const frPart = section("fr", kind, values, url);
  const arPart = section("ar", kind, values, url);
  return {
    to,
    subject: `${frPart.subject} · ${arPart.subject}`,
    html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#171717;max-width:560px;margin:0 auto;padding:24px">${frPart.html}<hr style="border:none;border-top:1px solid #e5e5e5;margin:0 0 32px">${arPart.html}</body></html>`,
    text: `${frPart.text}\n\n---\n\n${arPart.text}`,
  };
}

export function invitationEmail(input: {
  to: string;
  organization: string;
  inviter: string;
  url: string;
}): EmailMessage {
  return bilingual(
    "invitation",
    input.to,
    { organization: input.organization, inviter: input.inviter },
    input.url,
  );
}

export function resetPasswordEmail(input: { to: string; url: string }): EmailMessage {
  return bilingual("resetPassword", input.to, {}, input.url);
}
