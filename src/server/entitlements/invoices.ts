import "server-only";

import { sql } from "drizzle-orm";

import { withTenant } from "@/db/tenant";
import { invoiceRemaining, type InvoiceState, invoiceState } from "@/lib/billing";
import { type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { assertCan, type TenantCtx } from "@/server/auth/session";

/** An invoice of the organization's account, as the console shares it (`tenant_invoices()`). */
export type TenantInvoice = {
  id: string;
  number: string;
  issuedOn: CalendarDate;
  dueOn: CalendarDate;
  periodStart: CalendarDate | null;
  periodEnd: CalendarDate | null;
  totalTtc: bigint;
  credited: bigint;
  paid: bigint;
  remaining: bigint;
  state: InvoiceState;
  hasPdf: boolean;
  creditNotes: {
    id: string;
    number: string;
    issuedOn: CalendarDate;
    amountTtc: bigint;
    hasPdf: boolean;
  }[];
};

type RawInvoice = Omit<
  TenantInvoice,
  "totalTtc" | "credited" | "paid" | "remaining" | "state" | "hasPdf" | "creditNotes"
> & {
  totalTtc: string;
  credited: string;
  paid: string;
  pdfKey: string | null;
  creditNotes: {
    id: string;
    number: string;
    issuedOn: CalendarDate;
    amountTtc: string;
    pdfKey: string | null;
  }[];
};

/** Where to pay the operator: its legal name, bank and RIB. */
export type PaymentDetails = { legalName: string; bank: string | null; rib: string | null };

async function readInvoices(ctx: TenantCtx): Promise<{
  raw: RawInvoice[];
  payTo: PaymentDetails | null;
}> {
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.execute<{ data: RawInvoice[] | null }>(
      sql`select console.tenant_invoices() as data`,
    );
    const { rows: details } = await tx.execute<{ data: PaymentDetails | null }>(
      sql`select console.tenant_payment_details() as data`,
    );
    return { raw: rows[0]?.data ?? [], payTo: details[0]?.data ?? null };
  });
}

/**
 * The subscription page's invoices (CLAUDE.console.md §11, `subscription:read`): the account's
 * invoices and credit notes with what remains and their state, and the operator's bank details.
 */
export async function getTenantInvoices(
  ctx: TenantCtx,
): Promise<{ invoices: TenantInvoice[]; payTo: PaymentDetails | null }> {
  assertCan(ctx, "subscription:read");
  const { raw, payTo } = await readInvoices(ctx);
  const today = todayInAlgiers();
  const invoices = raw.map(({ pdfKey, creditNotes, ...row }) => {
    const amounts = {
      totalTtc: BigInt(row.totalTtc),
      credited: BigInt(row.credited),
      paid: BigInt(row.paid),
    };
    return {
      ...row,
      ...amounts,
      remaining: invoiceRemaining(amounts),
      state: invoiceState({ ...amounts, dueOn: row.dueOn }, today),
      hasPdf: pdfKey !== null,
      creditNotes: creditNotes.map(({ pdfKey: notePdf, amountTtc, ...note }) => ({
        ...note,
        amountTtc: BigInt(amountTtc),
        hasPdf: notePdf !== null,
      })),
    };
  });
  return { invoices, payTo };
}

/**
 * The stored PDF of one of the account's invoices or credit notes, for its download route; null
 * for anything else (another account's, unknown, not rendered yet).
 */
export async function tenantInvoiceFile(
  ctx: TenantCtx,
  id: string,
): Promise<{ storageKey: string; fileName: string } | null> {
  assertCan(ctx, "subscription:read");
  const { raw } = await readInvoices(ctx);
  for (const found of raw) {
    if (found.id === id) {
      return found.pdfKey ? { storageKey: found.pdfKey, fileName: `${found.number}.pdf` } : null;
    }
    const note = found.creditNotes.find((n) => n.id === id);
    if (note)
      return note.pdfKey ? { storageKey: note.pdfKey, fileName: `${note.number}.pdf` } : null;
  }
  return null;
}
