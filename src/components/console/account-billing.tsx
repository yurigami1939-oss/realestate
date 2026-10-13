import { getTranslations } from "next-intl/server";

import {
  CancelPaymentDialog,
  CreditNoteDialog,
  type DraftLineInput,
  IssueInvoiceDialog,
  PaymentDialog,
} from "@/components/console/billing-forms";
import { InvoiceStateBadge } from "@/components/subscription/invoice-state-badge";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/locales";
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { formatDZD, toDecimalString } from "@/lib/money";
import { AppError } from "@/lib/result";
import { draftInvoice, getAccountBilling, getOperatorProfile } from "@/server/console/billing";
import type { OperatorCtx } from "@/server/console/context";

/**
 * An account's invoices (CLAUDE.console.md §11): the next invoice prefilled to issue, each
 * invoice with its state, what remains, its PDF, payment and credit note; the credit notes and
 * payments (a payment cancelled with its reason).
 */
export async function AccountBilling({
  operator,
  billingAccountId,
  locale,
}: {
  operator: OperatorCtx;
  billingAccountId: string;
  locale: Locale;
}) {
  const t = await getTranslations("console.billing");
  const today = todayInAlgiers();
  const money = (v: bigint) => formatDZD(v, locale);
  const input = (v: bigint) => toDecimalString(v).replace(".", ",");
  const { invoices, creditNotes, payments } = await getAccountBilling(billingAccountId);
  const profile = await getOperatorProfile();
  let lines: DraftLineInput[] | null = null;
  try {
    const draft = await draftInvoice(operator, billingAccountId);
    lines = draft.lines.map((l) => ({
      kind: l.kind,
      addonCode: l.addonCode ?? "",
      labelFr: l.labelFr,
      labelAr: l.labelAr,
      periodStart: l.periodStart ?? "",
      periodEnd: l.periodEnd ?? "",
      quantity: String(l.quantity),
      unitPrice: input(l.unitPrice),
    }));
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "CONFLICT") throw error;
  }
  const numberOf = new Map(invoices.map((i) => [i.id, i.number]));

  return (
    <div className="space-y-3" data-testid="account-billing">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!profile ? (
          <p className="text-footnote text-muted-foreground">
            {t("noProfile")}{" "}
            <Link href="/console/settings" className="text-primary hover:underline">
              {t("settingsLink")}
            </Link>
          </p>
        ) : lines ? (
          <IssueInvoiceDialog billingAccountId={billingAccountId} lines={lines} today={today} />
        ) : (
          <p className="text-footnote text-muted-foreground">{t("pilot")}</p>
        )}
      </div>

      {invoices.length === 0 ? (
        <p className="empty-state">{t("empty")}</p>
      ) : (
        <ul
          className="divide-y overflow-hidden rounded-xl bg-card shadow-card"
          data-testid="account-invoices"
        >
          {invoices.map((inv) => (
            <li key={inv.id} className="space-y-2 px-4 py-3" data-invoice={inv.number}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium tabular-nums" dir="ltr">
                    {inv.number}
                  </span>
                  <InvoiceStateBadge state={inv.state} />
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {inv.hasPdf ? (
                    <a
                      href={`/api/console/documents/${inv.id}`}
                      target="_blank"
                      rel="noopener"
                      className="px-2 text-sm text-primary hover:underline"
                    >
                      {t("pdf")}
                    </a>
                  ) : (
                    <span className="px-2 text-footnote text-muted-foreground">
                      {t("pdfPending")}
                    </span>
                  )}
                  {inv.remaining > 0n ? (
                    <>
                      <PaymentDialog
                        invoice={{
                          id: inv.id,
                          number: inv.number,
                          remaining: money(inv.remaining),
                          remainingInput: input(inv.remaining),
                        }}
                        today={today}
                      />
                      <CreditNoteDialog
                        invoice={{
                          id: inv.id,
                          number: inv.number,
                          remaining: money(inv.remaining),
                          remainingInput: input(inv.remaining),
                        }}
                        today={today}
                      />
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-footnote text-muted-foreground tabular-nums">
                <span>
                  {t("issuedOnShort")} {formatDate(inv.issuedOn)}
                </span>
                <span>
                  {t("dueOn")} {formatDate(inv.dueOn)}
                </span>
                <span>
                  {t("total")} {money(inv.totalTtc)}
                </span>
                <span>
                  {t("remaining")} {money(inv.remaining)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {creditNotes.length > 0 ? (
        <div className="space-y-1">
          <h3 className="px-4 text-footnote font-medium text-muted-foreground">
            {t("creditNotes")}
          </h3>
          <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-card">
            {creditNotes.map((note) => (
              <li
                key={note.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm"
              >
                <span>
                  <span className="font-medium tabular-nums" dir="ltr">
                    {note.number}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {t("onInvoice", { number: numberOf.get(note.invoiceId) ?? "" })} · {note.reason}
                  </span>
                </span>
                <span className="flex items-center gap-3 tabular-nums">
                  {formatDate(note.issuedOn)} · {money(note.amountTtc)}
                  {note.hasPdf ? (
                    <a
                      href={`/api/console/documents/${note.id}`}
                      target="_blank"
                      rel="noopener"
                      className="text-primary hover:underline"
                    >
                      {t("pdf")}
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {payments.length > 0 ? (
        <div className="space-y-1">
          <h3 className="px-4 text-footnote font-medium text-muted-foreground">{t("payments")}</h3>
          <ul
            className="divide-y overflow-hidden rounded-xl bg-card shadow-card"
            data-testid="account-payments"
          >
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
              >
                <span className={p.cancelledAt ? "text-muted-foreground line-through" : undefined}>
                  {formatDate(p.paidOn)} · {t(`methods.${p.method}`)}
                  {p.reference ? ` · ${p.reference}` : ""} ·{" "}
                  {t("onInvoice", { number: numberOf.get(p.invoiceId) ?? "" })}
                </span>
                <span className="flex items-center gap-2 tabular-nums">
                  {money(p.amount)}
                  {p.cancelledAt ? (
                    <span className="text-footnote text-danger">
                      {t("cancelled", { reason: p.cancelReason ?? "" })}
                    </span>
                  ) : (
                    <CancelPaymentDialog paymentId={p.id} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
