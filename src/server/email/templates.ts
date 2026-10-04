import "server-only";

import { createTranslator } from "next-intl";

import type { EmailMessage } from "@/jobs/queues";
import { formatDate } from "@/lib/dates";
import { formatDZD } from "@/lib/money";

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

type DigestSale = {
  number: string;
  buyers: string;
  unitCode: string;
  projectName: string;
  overdue: bigint;
  daysLate: number;
};

const DIGEST_ROWS = 25;

/**
 * Daily overdue digest for cashiers and sales managers (CLAUDE.md §12): the most late sales
 * first, French then Arabic like the other staff e-mails sent by jobs.
 */
export function overdueDigestEmail(input: {
  to: string;
  organization: string;
  date: string;
  sales: DigestSale[];
  url: string;
}): EmailMessage {
  const total = input.sales.reduce((sum, s) => sum + s.overdue, 0n);
  const shown = input.sales.slice(0, DIGEST_ROWS);
  const part = (locale: "fr" | "ar") => {
    const t = createTranslator({
      locale,
      messages: catalogs[locale],
      namespace: "emails.overdueDigest",
    });
    const dir = locale === "ar" ? "rtl" : "ltr";
    const align = dir === "rtl" ? "right" : "left";
    const money = (v: bigint) => formatDZD(v, locale);
    const values = {
      organization: input.organization,
      date: formatDate(input.date),
      count: input.sales.length,
      total: money(total),
    };
    const cell = `style="padding:6px 8px;border-bottom:1px solid #e5e5e5;text-align:${align}"`;
    const rows = shown
      .map(
        (s) =>
          `<tr><td ${cell}><bdi>${escapeHtml(s.number)}</bdi></td><td ${cell}><bdi>${escapeHtml(s.buyers)}</bdi></td><td ${cell}><bdi>${escapeHtml(`${s.unitCode} · ${s.projectName}`)}</bdi></td><td ${cell}><bdi dir="ltr">${escapeHtml(money(s.overdue))}</bdi></td><td ${cell}>${escapeHtml(t("days", { days: s.daysLate }))}</td></tr>`,
      )
      .join("");
    const more =
      input.sales.length > shown.length
        ? `<p style="margin:8px 0">${escapeHtml(t("more", { count: input.sales.length - shown.length }))}</p>`
        : "";
    const head = (["sale", "buyers", "unit", "overdue", "late"] as const)
      .map((key) => `<th ${cell}>${escapeHtml(t(`columns.${key}`))}</th>`)
      .join("");
    const html = `
    <div dir="${dir}" lang="${locale}" style="text-align:${align};margin:0 0 32px">
      <p style="margin:0 0 12px">${escapeHtml(t("intro", values))}</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
      ${more}
      <p style="margin:20px 0"><a href="${escapeHtml(input.url)}" style="background:#171717;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("cta"))}</a></p>
    </div>`;
    const text = [
      t("intro", values),
      ...shown.map(
        (s) =>
          `- ${s.number} · ${s.buyers} · ${s.unitCode} · ${money(s.overdue)} · ${t("days", { days: s.daysLate })}`,
      ),
      `${t("cta")}: ${input.url}`,
    ].join("\n");
    return { subject: t("subject", values), html, text };
  };
  const frPart = part("fr");
  const arPart = part("ar");
  return {
    to: input.to,
    subject: `${frPart.subject} · ${arPart.subject}`,
    html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#171717;max-width:680px;margin:0 auto;padding:24px">${frPart.html}<hr style="border:none;border-top:1px solid #e5e5e5;margin:0 0 32px">${arPart.html}</body></html>`,
    text: `${frPart.text}\n\n---\n\n${arPart.text}`,
  };
}

type DigestUnit = {
  residenceName: string;
  code: string;
  coOwner: string | null;
  overdue: bigint;
  daysLate: number;
};

/**
 * Daily overdue charges digest for property managers and cashiers (CLAUDE.md §12): the most
 * late units first, French then Arabic like the other staff e-mails sent by jobs.
 */
export function chargesDigestEmail(input: {
  to: string;
  organization: string;
  date: string;
  units: DigestUnit[];
  url: string;
}): EmailMessage {
  const total = input.units.reduce((sum, u) => sum + u.overdue, 0n);
  const shown = input.units.slice(0, DIGEST_ROWS);
  const part = (locale: "fr" | "ar") => {
    const t = createTranslator({
      locale,
      messages: catalogs[locale],
      namespace: "emails.chargesDigest",
    });
    const dir = locale === "ar" ? "rtl" : "ltr";
    const align = dir === "rtl" ? "right" : "left";
    const money = (v: bigint) => formatDZD(v, locale);
    const values = {
      organization: input.organization,
      date: formatDate(input.date),
      count: input.units.length,
      total: money(total),
    };
    const owner = (u: DigestUnit) => u.coOwner ?? t("promoter");
    const cell = `style="padding:6px 8px;border-bottom:1px solid #e5e5e5;text-align:${align}"`;
    const rows = shown
      .map(
        (u) =>
          `<tr><td ${cell}><bdi>${escapeHtml(u.residenceName)}</bdi></td><td ${cell}><bdi dir="ltr">${escapeHtml(u.code)}</bdi></td><td ${cell}><bdi>${escapeHtml(owner(u))}</bdi></td><td ${cell}><bdi dir="ltr">${escapeHtml(money(u.overdue))}</bdi></td><td ${cell}>${escapeHtml(t("days", { days: u.daysLate }))}</td></tr>`,
      )
      .join("");
    const more =
      input.units.length > shown.length
        ? `<p style="margin:8px 0">${escapeHtml(t("more", { count: input.units.length - shown.length }))}</p>`
        : "";
    const head = (["residence", "unit", "coOwner", "overdue", "late"] as const)
      .map((key) => `<th ${cell}>${escapeHtml(t(`columns.${key}`))}</th>`)
      .join("");
    const html = `
    <div dir="${dir}" lang="${locale}" style="text-align:${align};margin:0 0 32px">
      <p style="margin:0 0 12px">${escapeHtml(t("intro", values))}</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
      ${more}
      <p style="margin:20px 0"><a href="${escapeHtml(input.url)}" style="background:#171717;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("cta"))}</a></p>
    </div>`;
    const text = [
      t("intro", values),
      ...shown.map(
        (u) =>
          `- ${u.residenceName} · ${u.code} · ${owner(u)} · ${money(u.overdue)} · ${t("days", { days: u.daysLate })}`,
      ),
      `${t("cta")}: ${input.url}`,
    ].join("\n");
    return { subject: t("subject", values), html, text };
  };
  const frPart = part("fr");
  const arPart = part("ar");
  return {
    to: input.to,
    subject: `${frPart.subject} · ${arPart.subject}`,
    html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#171717;max-width:680px;margin:0 auto;padding:24px">${frPart.html}<hr style="border:none;border-top:1px solid #e5e5e5;margin:0 0 32px">${arPart.html}</body></html>`,
    text: `${frPart.text}\n\n---\n\n${arPart.text}`,
  };
}
