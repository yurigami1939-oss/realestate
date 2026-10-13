import "server-only";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { and, asc, eq, isNull } from "drizzle-orm";

import { consoleDb } from "@/db/console-client";
import { creditNote, invoice, invoiceLine } from "@/db/schema";
import { env } from "@/env";
import { enqueue } from "@/jobs/enqueue";
import { renderPdf } from "@/pdf/render";
import { type ConsoleDocumentData, ConsoleInvoiceTemplate } from "@/pdf/templates/console-invoice";
import { consoleDocumentEmail } from "@/server/email/templates";
import { getObjectBytes, putObject } from "@/server/files/storage";

import { accountGerants } from "./lifecycle";

/** Static HTML of an operator invoice or credit note (rendered by Chromium in the worker). */
export function consoleDocumentHtml(data: ConsoleDocumentData): string {
  return `<!doctype html>${renderToStaticMarkup(createElement(ConsoleInvoiceTemplate, { data }))}`;
}

/** The operator's logo as a data URI (documents render offline); none when unreadable. */
async function logoDataUri(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  try {
    const bytes = await getObjectBytes(key);
    const type = key.endsWith(".png") ? "image/png" : "image/jpeg";
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

/** Where an operator document is stored: outside the tenants' `org/` prefix. */
export const consoleDocumentKey = (billingAccountId: string, id: string) =>
  `console/invoices/${billingAccountId}/${id}.pdf`;

/** What an invoice or a credit note prints, from its snapshots. */
export async function loadConsoleDocument(
  kind: "invoice" | "credit_note",
  id: string,
): Promise<{
  data: ConsoleDocumentData;
  billingAccountId: string;
  pdfKey: string | null;
} | null> {
  if (kind === "invoice") {
    const [row] = await consoleDb.select().from(invoice).where(eq(invoice.id, id));
    if (!row) return null;
    const lines = await consoleDb
      .select()
      .from(invoiceLine)
      .where(eq(invoiceLine.invoiceId, id))
      .orderBy(asc(invoiceLine.position));
    return {
      billingAccountId: row.billingAccountId,
      pdfKey: row.pdfKey,
      data: {
        kind,
        number: row.number,
        issuedOn: row.issuedOn,
        dueOn: row.dueOn,
        seller: row.seller,
        sellerLogo: await logoDataUri(row.seller.logoKey),
        buyer: row.buyer,
        lines: lines.map((l) => ({
          labelFr: l.labelFr,
          labelAr: l.labelAr,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          amount: l.amount,
        })),
        vatRateBp: row.vatRateBp,
        totals: { ht: row.totalHt, vat: row.totalVat, ttc: row.totalTtc },
      },
    };
  }
  const [row] = await consoleDb
    .select({ note: creditNote, invoice })
    .from(creditNote)
    .innerJoin(invoice, eq(invoice.id, creditNote.invoiceId))
    .where(eq(creditNote.id, id));
  if (!row) return null;
  return {
    billingAccountId: row.note.billingAccountId,
    pdfKey: row.note.pdfKey,
    data: {
      kind,
      number: row.note.number,
      issuedOn: row.note.issuedOn,
      dueOn: null,
      seller: row.invoice.seller,
      sellerLogo: await logoDataUri(row.invoice.seller.logoKey),
      buyer: row.invoice.buyer,
      lines: [],
      vatRateBp: row.invoice.vatRateBp,
      totals: { ht: row.note.amountHt, vat: row.note.amountVat, ttc: row.note.amountTtc },
      invoiceNumber: row.invoice.number,
      reason: row.note.reason,
    },
  };
}

/**
 * `console.document` (CLAUDE.console.md §11): renders an invoice or a credit note once, stores it
 * and links it, then e-mails it to the gérants of the account's organizations (bilingual, the PDF
 * attached). Idempotent: an already linked document is neither rendered nor sent again.
 */
export async function renderConsoleDocument(
  kind: "invoice" | "credit_note",
  id: string,
): Promise<"rendered" | "skipped"> {
  const loaded = await loadConsoleDocument(kind, id);
  if (!loaded || loaded.pdfKey) return "skipped";
  const key = consoleDocumentKey(loaded.billingAccountId, id);
  const pdf = await renderPdf(consoleDocumentHtml(loaded.data));
  await putObject(key, pdf, "application/pdf");
  const table = kind === "invoice" ? invoice : creditNote;
  const linked = await consoleDb
    .update(table)
    .set({ pdfKey: key })
    .where(and(eq(table.id, id), isNull(table.pdfKey)))
    .returning({ id: table.id });
  if (linked.length === 0) return "skipped";
  for (const to of await accountGerants(loaded.billingAccountId)) {
    await enqueue(
      "email.send",
      consoleDocumentEmail({
        to,
        kind,
        number: loaded.data.number,
        organization: loaded.data.buyer.legalName,
        amount: loaded.data.totals.ttc,
        dueOn: loaded.data.dueOn,
        url: `${env.BETTER_AUTH_URL}/fr/settings/subscription`,
        attachment: {
          fileName: `${loaded.data.number}.pdf`,
          storageKey: key,
          contentType: "application/pdf",
        },
      }),
      { singletonKey: `console-document:${id}:${to}` },
    );
  }
  return "rendered";
}
