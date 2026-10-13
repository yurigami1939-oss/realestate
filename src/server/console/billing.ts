import "server-only";

import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";

import { consoleDb, type ConsoleTx } from "@/db/console-client";
import {
  addon,
  billingAccount,
  consolePayment,
  creditNote,
  invoice,
  invoiceLine,
  operatorProfile,
  plan,
  subscription,
  subscriptionAddon,
  user,
} from "@/db/schema";
import { enqueue } from "@/jobs/enqueue";
import { vatSplit } from "@/lib/accounting";
import {
  addonLabels,
  averageLots,
  type ConsolePaymentMethod,
  type InvoiceLineKind,
  type InvoiceParty,
  invoiceRemaining,
  type InvoiceState,
  invoiceState,
  invoiceTotals,
  lineAmount,
  monthlyEquivalent,
  periodMonths,
  syndicTrueUp,
  type VatRegime,
} from "@/lib/billing";
import { addDays, addMonths, type CalendarDate, formatDate, todayInAlgiers } from "@/lib/dates";
import { applyRate, type Centimes, formatPercentInput } from "@/lib/money";
import { AppError } from "@/lib/result";
import type { AddonCode } from "@/lib/subscriptions";

import { recordConsoleAudit } from "./audit";
import type { OperatorCtx } from "./context";
import { syncEntitlement } from "./entitlements";
import { changeSubscriptionStatus, overdueInvoices } from "./lifecycle";
import { nextConsoleNumber } from "./numbering";

// ── The operator's profile ──────────────────────────────────────────────────────────────────

export type OperatorProfileInput = {
  legalName: string;
  brand: string | null;
  legalForm: string | null;
  address: string | null;
  wilaya: string | null;
  phone: string | null;
  email: string | null;
  rcNumber: string | null;
  nif: string | null;
  nis: string | null;
  aiNumber: string | null;
  bank: string | null;
  rib: string | null;
  vatRegime: VatRegime;
  vatRateBp: number;
  paymentTermsDays: number;
  footerFr: string | null;
  footerAr: string | null;
};

/** The operator's profile (one row), or null before it is set. */
export async function getOperatorProfile() {
  const [row] = await consoleDb.select().from(operatorProfile).where(eq(operatorProfile.id, 1));
  return row ?? null;
}

/** Saves the operator's profile, printed on the invoices issued afterwards. Audited. */
export async function saveOperatorProfile(ctx: OperatorCtx, input: OperatorProfileInput) {
  await consoleDb.transaction(async (tx) => {
    const [before] = await tx.select().from(operatorProfile).where(eq(operatorProfile.id, 1));
    await tx
      .insert(operatorProfile)
      .values({ id: 1, ...input })
      .onConflictDoUpdate({ target: operatorProfile.id, set: input });
    await recordConsoleAudit(tx, ctx, {
      action: "operator_profile.update",
      before: before ?? null,
      after: input,
    });
  });
}

/** The operator's logo (a stored image's key, or none), embedded in invoices issued afterwards. */
export async function setOperatorLogo(ctx: OperatorCtx, logoKey: string | null) {
  await consoleDb.transaction(async (tx) => {
    const updated = await tx
      .update(operatorProfile)
      .set({ logoKey })
      .where(eq(operatorProfile.id, 1))
      .returning({ id: operatorProfile.id });
    if (updated.length === 0) throw new AppError("CONFLICT", "console.errors.noOperatorProfile");
    await recordConsoleAudit(tx, ctx, { action: "operator_profile.logo", after: { logoKey } });
  });
}

// ── Drafting an invoice ─────────────────────────────────────────────────────────────────────

/** A line as the operator issues it (prefilled, then edited). */
export type DraftLine = {
  kind: InvoiceLineKind;
  addonCode: AddonCode | null;
  labelFr: string;
  labelAr: string;
  periodStart: CalendarDate | null;
  periodEnd: CalendarDate | null;
  quantity: number;
  unitPrice: Centimes;
};

/** Whole months from `start` to `end` (inclusive days), at least one. */
function monthsBetween(start: CalendarDate, end: CalendarDate): number {
  let months = 0;
  while (addDays(addMonths(start, months + 1), -1) <= end) months += 1;
  return Math.max(1, months);
}

/** The account's managed lots now: each organization's latest snapshot, summed. */
async function managedLotsNow(tx: ConsoleTx, billingAccountId: string): Promise<number> {
  const { rows } = await tx.execute<{ lots: number }>(sql`
    select coalesce(sum(u.managed_lots), 0)::int as lots
    from console.account_organization ao
    left join lateral (
      select t.managed_lots from console.tenant_usage t
      where t.organization_id = ao.organization_id order by t.measured_on desc limit 1
    ) u on true
    where ao.billing_account_id = ${billingAccountId}`);
  return rows[0]?.lots ?? 0;
}

/**
 * The account's managed lots month by month over a period: in each month, each organization's
 * latest snapshot of that month, summed (months without a snapshot left out).
 */
async function managedLotsByMonth(
  tx: ConsoleTx,
  billingAccountId: string,
  start: CalendarDate,
  end: CalendarDate,
): Promise<number[]> {
  const { rows } = await tx.execute<{ month: string; lots: number }>(sql`
    select month, sum(managed_lots)::int as lots from (
      select to_char(t.measured_on, 'YYYY-MM') as month, t.managed_lots,
        row_number() over (
          partition by t.organization_id, to_char(t.measured_on, 'YYYY-MM')
          order by t.measured_on desc
        ) as rank
      from console.tenant_usage t
      join console.account_organization ao on ao.organization_id = t.organization_id
      where ao.billing_account_id = ${billingAccountId}
        and t.measured_on between ${start}::date and ${end}::date
    ) latest
    where rank = 1
    group by month
    order by month`);
  return rows.map((r) => r.lots);
}

/**
 * An invoice not wholly cancelled by credit notes: what still invoices its period (a period whose
 * invoice was credited in full is invoiced again). In WHERE clauses only (columns qualified).
 */
const notFullyCredited = sql`${invoice.totalTtc} > coalesce(
  (select sum(c.amount_ttc) from console.credit_note c where c.invoice_id = ${invoice.id}), 0)`;

/**
 * The lines prefilled for an account's next invoice (CLAUDE.console.md §11), for the period after
 * the last one invoiced (the current period on a first invoice): the plan at the subscription's
 * price after discount, each live add-on at its price — the syndic in lot-months of the managed
 * lots last measured —, the syndic's true-up of the period invoiced before (lots managed on
 * average beyond those billed, when positive) and, on the first invoice, the plan's setup fee.
 * Refused for a pilot never activated.
 */
export async function draftInvoice(
  _ctx: OperatorCtx,
  billingAccountId: string,
): Promise<{ period: { start: CalendarDate; end: CalendarDate }; lines: DraftLine[] }> {
  return consoleDb.transaction(async (tx) => {
    const [row] = await tx
      .select({ subscription, plan })
      .from(subscription)
      .innerJoin(plan, eq(plan.id, subscription.planId))
      .where(eq(subscription.billingAccountId, billingAccountId));
    if (!row) throw new AppError("NOT_FOUND", "console.errors.accountUnknown");
    const sub = row.subscription;
    if (!sub.activatedAt) throw new AppError("CONFLICT", "console.errors.invoicePilot");
    const months = periodMonths(sub.billingPeriod);

    const [last] = await tx
      .select({
        invoiceId: invoiceLine.invoiceId,
        start: invoiceLine.periodStart,
        end: invoiceLine.periodEnd,
      })
      .from(invoiceLine)
      .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
      .where(
        and(
          eq(invoice.billingAccountId, billingAccountId),
          eq(invoiceLine.kind, "subscription"),
          notFullyCredited,
        ),
      )
      .orderBy(desc(invoiceLine.periodEnd))
      .limit(1);
    const today = todayInAlgiers();
    const start = last?.end ? addDays(last.end, 1) : (sub.currentPeriodStart ?? today);
    const end =
      !last?.end && sub.currentPeriodStart && sub.currentPeriodEnd
        ? sub.currentPeriodEnd
        : addDays(addMonths(start, months), -1);
    const span = {
      fr: `du ${formatDate(start)} au ${formatDate(end)}`,
      ar: `من ${formatDate(start)} إلى ${formatDate(end)}`,
    };
    const period = { periodStart: start, periodEnd: end };

    const lines: DraftLine[] = [];
    const discount =
      sub.discountBp > 0
        ? {
            fr: ` (remise ${formatPercentInput(sub.discountBp)} %)`,
            ar: ` (تخفيض ${formatPercentInput(sub.discountBp)} %)`,
          }
        : { fr: "", ar: "" };
    lines.push({
      kind: "subscription",
      addonCode: null,
      labelFr: `Abonnement ${row.plan.nameFr} ${span.fr}${discount.fr}`,
      labelAr: `اشتراك ${row.plan.nameAr} ${span.ar}${discount.ar}`,
      ...period,
      quantity: 1,
      unitPrice: sub.price - applyRate(sub.price, sub.discountBp),
    });

    const live = await tx
      .select({
        code: subscriptionAddon.addonCode,
        price: subscriptionAddon.price,
        addedOn: subscriptionAddon.addedOn,
        basis: addon.basis,
      })
      .from(subscriptionAddon)
      .leftJoin(addon, and(eq(addon.code, subscriptionAddon.addonCode), isNull(addon.archivedAt)))
      .where(and(eq(subscriptionAddon.subscriptionId, sub.id), isNull(subscriptionAddon.removedOn)))
      .orderBy(asc(subscriptionAddon.addonCode));
    for (const taken of live) {
      const label = addonLabels[taken.code];
      if (taken.basis !== "per_managed_lot") {
        lines.push({
          kind: "addon",
          addonCode: taken.code,
          labelFr: `Option ${label.fr} ${span.fr}`,
          labelAr: `خيار ${label.ar} ${span.ar}`,
          ...period,
          quantity: 1,
          unitPrice: taken.price,
        });
        continue;
      }
      const lots = await managedLotsNow(tx, billingAccountId);
      if (lots > 0) {
        lines.push({
          kind: "addon",
          addonCode: taken.code,
          labelFr: `${label.fr} : ${lots} lots × ${months} mois ${span.fr}`,
          labelAr: `${label.ar}: ${lots} وحدة × ${months} أشهر ${span.ar}`,
          ...period,
          quantity: lots * months,
          unitPrice: taken.price,
        });
      }
      // The true-up of the period invoiced before: the lots managed beyond those billed — all of
      // them when none were (no lots measured then), unless the add-on came during that period.
      if (!last?.start || !last.end) continue;
      const [billed] = await tx
        .select({ quantity: invoiceLine.quantity })
        .from(invoiceLine)
        .where(
          and(
            eq(invoiceLine.invoiceId, last.invoiceId),
            eq(invoiceLine.kind, "addon"),
            eq(invoiceLine.addonCode, taken.code),
          ),
        );
      if (!billed && taken.addedOn > last.start) continue;
      const lastMonths = monthsBetween(last.start, last.end);
      const billedLots = billed ? Math.round(billed.quantity / lastMonths) : 0;
      const average = averageLots(
        await managedLotsByMonth(tx, billingAccountId, last.start, last.end),
      );
      const extra = syndicTrueUp({ averageLots: average, billedLots, months: lastMonths });
      if (extra > 0) {
        const lastSpan = `${formatDate(last.start)} – ${formatDate(last.end)}`;
        lines.push({
          kind: "adjustment",
          addonCode: taken.code,
          labelFr: `Régularisation ${label.fr} ${lastSpan} : ${average - billedLots} lots × ${lastMonths} mois`,
          labelAr: `تسوية ${label.ar} ${lastSpan}: ${average - billedLots} وحدة × ${lastMonths} أشهر`,
          periodStart: last.start,
          periodEnd: last.end,
          quantity: extra,
          unitPrice: taken.price,
        });
      }
    }

    const [earlier] = await tx
      .select({ id: invoice.id })
      .from(invoice)
      .where(and(eq(invoice.billingAccountId, billingAccountId), notFullyCredited))
      .limit(1);
    if (!earlier && row.plan.setupFee > 0n) {
      lines.push({
        kind: "setup",
        addonCode: null,
        labelFr: "Mise en service : reprise des données et formation",
        labelAr: "الإطلاق: استرجاع البيانات والتكوين",
        periodStart: null,
        periodEnd: null,
        quantity: 1,
        unitPrice: row.plan.setupFee,
      });
    }
    return { period: { start, end }, lines };
  });
}

// ── Issuing ─────────────────────────────────────────────────────────────────────────────────

/** Whether an account has an invoice due before `today` with something unpaid. */
async function hasOverdueInvoice(
  tx: ConsoleTx,
  billingAccountId: string,
  today: CalendarDate,
): Promise<boolean> {
  const { rows } = await tx.execute<{ overdue: boolean }>(sql`
    select exists (
      select 1 from console.invoice i
      where i.billing_account_id = ${billingAccountId} and i.due_on < ${today}::date
        and i.total_ttc
          - coalesce((select sum(c.amount_ttc) from console.credit_note c where c.invoice_id = i.id), 0)
          - coalesce((select sum(p.amount) from console.payment p
                      where p.invoice_id = i.id and p.cancelled_at is null), 0) > 0
    ) as overdue`);
  return rows[0]?.overdue === true;
}

/**
 * After a payment or a credit note (CLAUDE.console.md §6): an activated `past_due` account with
 * nothing overdue any more is `active` again.
 */
async function settleAccount(tx: ConsoleTx, ctx: OperatorCtx, billingAccountId: string) {
  const [sub] = await tx
    .select({ status: subscription.status, activatedAt: subscription.activatedAt })
    .from(subscription)
    .where(eq(subscription.billingAccountId, billingAccountId));
  if (sub?.status !== "past_due" || !sub.activatedAt) return;
  if (await hasOverdueInvoice(tx, billingAccountId, todayInAlgiers())) return;
  await changeSubscriptionStatus(ctx, { billingAccountId, to: "active" }, tx);
}

/**
 * Issues an invoice (CLAUDE.console.md §11) in one console transaction: `FAC-` number, the
 * operator and the client snapshotted, totals (VAT half-up on the total, none under the no-VAT
 * regime), due after the operator's payment terms; a subscription line beyond the current period
 * moves the subscription's current period (and its organizations' entitlement) to it. Audited;
 * the PDF follows (job), then the e-mail to the gérants.
 */
export async function issueInvoice(
  ctx: OperatorCtx,
  input: { billingAccountId: string; issuedOn: CalendarDate; lines: DraftLine[] },
): Promise<{ invoiceId: string; number: string }> {
  if (input.issuedOn > todayInAlgiers()) {
    throw new AppError("VALIDATION", "console.errors.futureDate", {
      fieldErrors: { issuedOn: ["console.errors.futureDate"] },
    });
  }
  if (input.lines.length === 0) throw new AppError("VALIDATION", "console.errors.invoiceEmpty");
  const issued = await consoleDb.transaction(async (tx) => {
    const [profile] = await tx.select().from(operatorProfile).where(eq(operatorProfile.id, 1));
    if (!profile) throw new AppError("CONFLICT", "console.errors.noOperatorProfile");
    const [account] = await tx
      .select()
      .from(billingAccount)
      .where(eq(billingAccount.id, input.billingAccountId));
    if (!account) throw new AppError("NOT_FOUND", "console.errors.accountUnknown");
    const [sub] = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.billingAccountId, input.billingAccountId))
      .for("update");
    const vatRateBp = profile.vatRegime === "vat" ? profile.vatRateBp : null;
    const lines = input.lines.map((line, index) => ({
      ...line,
      position: index + 1,
      amount: lineAmount(line.quantity, line.unitPrice),
    }));
    const totals = invoiceTotals(lines, vatRateBp);
    if (totals.ttc <= 0n) throw new AppError("VALIDATION", "console.errors.invoiceEmpty");
    const covered = lines.find((l) => l.kind === "subscription" && l.periodStart && l.periodEnd);
    // A period is invoiced once (a stale draft, a second tab): credit the earlier invoice first.
    for (const line of lines) {
      if (line.kind !== "subscription" || !line.periodStart || !line.periodEnd) continue;
      const [already] = await tx
        .select({ number: invoice.number })
        .from(invoiceLine)
        .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
        .where(
          and(
            eq(invoice.billingAccountId, input.billingAccountId),
            eq(invoiceLine.kind, "subscription"),
            lte(invoiceLine.periodStart, line.periodEnd),
            gte(invoiceLine.periodEnd, line.periodStart),
            notFullyCredited,
          ),
        )
        .limit(1);
      if (already) {
        throw new AppError("CONFLICT", "console.errors.periodInvoiced", {
          details: { number: already.number },
        });
      }
    }

    const { number } = await nextConsoleNumber(tx, "invoice", input.issuedOn);
    const seller: InvoiceParty = {
      legalName: profile.legalName,
      brand: profile.brand,
      legalForm: profile.legalForm,
      address: profile.address,
      wilaya: profile.wilaya,
      phone: profile.phone,
      email: profile.email,
      rcNumber: profile.rcNumber,
      nif: profile.nif,
      nis: profile.nis,
      aiNumber: profile.aiNumber,
      bank: profile.bank,
      rib: profile.rib,
      footerFr: profile.footerFr,
      footerAr: profile.footerAr,
      logoKey: profile.logoKey,
    };
    const buyer: InvoiceParty = {
      legalName: account.legalName,
      address: account.address,
      wilaya: account.wilaya,
      phone: account.phone,
      email: account.email,
      rcNumber: account.rcNumber,
      nif: account.nif,
      nis: account.nis,
      aiNumber: account.aiNumber,
    };
    const [created] = await tx
      .insert(invoice)
      .values({
        billingAccountId: input.billingAccountId,
        number,
        issuedOn: input.issuedOn,
        dueOn: addDays(input.issuedOn, profile.paymentTermsDays),
        periodStart: covered?.periodStart ?? null,
        periodEnd: covered?.periodEnd ?? null,
        seller,
        buyer,
        vatRateBp,
        totalHt: totals.ht,
        totalVat: totals.vat,
        totalTtc: totals.ttc,
        issuedBy: ctx.userId,
      })
      .returning({ id: invoice.id });
    if (!created) throw new Error("issueInvoice: no row returned");
    await tx.insert(invoiceLine).values(
      lines.map((line) => ({
        invoiceId: created.id,
        position: line.position,
        kind: line.kind,
        addonCode: line.addonCode,
        labelFr: line.labelFr,
        labelAr: line.labelAr,
        periodStart: line.periodStart,
        periodEnd: line.periodEnd,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
      })),
    );
    // The subscription's current period follows the period invoiced.
    if (
      sub &&
      covered?.periodStart &&
      covered.periodEnd &&
      (!sub.currentPeriodEnd || covered.periodEnd > sub.currentPeriodEnd)
    ) {
      await tx
        .update(subscription)
        .set({ currentPeriodStart: covered.periodStart, currentPeriodEnd: covered.periodEnd })
        .where(eq(subscription.id, sub.id));
      await syncEntitlement(tx, input.billingAccountId);
    }
    await recordConsoleAudit(tx, ctx, {
      action: "invoice.issue",
      billingAccountId: input.billingAccountId,
      after: {
        number,
        issuedOn: input.issuedOn,
        totalHt: totals.ht,
        totalVat: totals.vat,
        totalTtc: totals.ttc,
        lines: lines.map((l) => ({ kind: l.kind, quantity: l.quantity, amount: l.amount })),
      },
    });
    return { invoiceId: created.id, number };
  });
  await enqueue(
    "console.document",
    { kind: "invoice", id: issued.invoiceId },
    { singletonKey: `invoice:${issued.invoiceId}` },
  );
  return issued;
}

/** An invoice with what was credited and paid on it, locked for the change about to be made. */
async function lockedInvoice(tx: ConsoleTx, invoiceId: string) {
  const [row] = await tx.select().from(invoice).where(eq(invoice.id, invoiceId)).for("update");
  if (!row) throw new AppError("NOT_FOUND", "console.errors.invoiceUnknown");
  const [credited] = await tx
    .select({ total: sql<string>`coalesce(sum(${creditNote.amountTtc}), 0)::text` })
    .from(creditNote)
    .where(eq(creditNote.invoiceId, invoiceId));
  const [paid] = await tx
    .select({ total: sql<string>`coalesce(sum(${consolePayment.amount}), 0)::text` })
    .from(consolePayment)
    .where(and(eq(consolePayment.invoiceId, invoiceId), isNull(consolePayment.cancelledAt)));
  const amounts = {
    totalTtc: row.totalTtc,
    credited: BigInt(credited?.total ?? "0"),
    paid: BigInt(paid?.total ?? "0"),
  };
  return { invoice: row, remaining: invoiceRemaining(amounts) };
}

/**
 * A credit note on an invoice (CLAUDE.console.md §11): at most what remains unpaid, its HT and
 * VAT split at the invoice's rate, numbered `AVO-`, with a reason. Audited; the account's state
 * is re-evaluated, the PDF follows.
 */
export async function issueCreditNote(
  ctx: OperatorCtx,
  input: { invoiceId: string; amount: Centimes; reason: string; issuedOn: CalendarDate },
): Promise<{ creditNoteId: string; number: string }> {
  if (input.issuedOn > todayInAlgiers()) {
    throw new AppError("VALIDATION", "console.errors.futureDate");
  }
  const issued = await consoleDb.transaction(async (tx) => {
    const { invoice: target, remaining } = await lockedInvoice(tx, input.invoiceId);
    if (input.issuedOn < target.issuedOn) {
      throw new AppError("VALIDATION", "console.errors.beforeInvoice");
    }
    if (input.amount <= 0n || input.amount > remaining) {
      throw new AppError("CONFLICT", "console.errors.aboveRemaining", {
        fieldErrors: { amount: ["console.errors.aboveRemaining"] },
      });
    }
    const split =
      target.vatRateBp === null
        ? { ht: input.amount, vat: 0n }
        : vatSplit(input.amount, target.vatRateBp);
    const { number } = await nextConsoleNumber(tx, "credit_note", input.issuedOn);
    const [created] = await tx
      .insert(creditNote)
      .values({
        invoiceId: target.id,
        billingAccountId: target.billingAccountId,
        number,
        issuedOn: input.issuedOn,
        amountHt: split.ht,
        amountVat: split.vat,
        amountTtc: input.amount,
        reason: input.reason,
        issuedBy: ctx.userId,
      })
      .returning({ id: creditNote.id });
    if (!created) throw new Error("issueCreditNote: no row returned");
    await recordConsoleAudit(tx, ctx, {
      action: "credit_note.issue",
      billingAccountId: target.billingAccountId,
      after: { number, invoice: target.number, amountTtc: input.amount },
      reason: input.reason,
    });
    await settleAccount(tx, ctx, target.billingAccountId);
    return { creditNoteId: created.id, number };
  });
  await enqueue(
    "console.document",
    { kind: "credit_note", id: issued.creditNoteId },
    { singletonKey: `credit_note:${issued.creditNoteId}` },
  );
  return issued;
}

/**
 * A client's payment of an invoice (CLAUDE.console.md §11): at most what remains, never cash,
 * paid from the invoice's day to today. Audited; the account's state is re-evaluated.
 */
export async function recordConsolePayment(
  ctx: OperatorCtx,
  input: {
    invoiceId: string;
    paidOn: CalendarDate;
    amount: Centimes;
    method: ConsolePaymentMethod;
    reference: string | null;
  },
): Promise<{ paymentId: string }> {
  return consoleDb.transaction(async (tx) => {
    const { invoice: target, remaining } = await lockedInvoice(tx, input.invoiceId);
    if (input.paidOn < target.issuedOn || input.paidOn > todayInAlgiers()) {
      throw new AppError("VALIDATION", "console.errors.paidOn", {
        fieldErrors: { paidOn: ["console.errors.paidOn"] },
      });
    }
    if (input.amount <= 0n || input.amount > remaining) {
      throw new AppError("CONFLICT", "console.errors.aboveRemaining", {
        fieldErrors: { amount: ["console.errors.aboveRemaining"] },
      });
    }
    const [created] = await tx
      .insert(consolePayment)
      .values({
        invoiceId: target.id,
        billingAccountId: target.billingAccountId,
        paidOn: input.paidOn,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        recordedBy: ctx.userId,
      })
      .returning({ id: consolePayment.id });
    if (!created) throw new Error("recordConsolePayment: no row returned");
    await recordConsoleAudit(tx, ctx, {
      action: "payment.record",
      billingAccountId: target.billingAccountId,
      after: {
        invoice: target.number,
        paidOn: input.paidOn,
        amount: input.amount,
        method: input.method,
      },
    });
    await settleAccount(tx, ctx, target.billingAccountId);
    return { paymentId: created.id };
  });
}

/** Cancels a payment (a bounced cheque) with a reason; never deleted. Audited. */
export async function cancelConsolePayment(
  ctx: OperatorCtx,
  input: { paymentId: string; reason: string },
): Promise<void> {
  await consoleDb.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(consolePayment)
      .where(eq(consolePayment.id, input.paymentId))
      .for("update");
    if (!row) throw new AppError("NOT_FOUND", "console.errors.paymentUnknown");
    if (row.cancelledAt) throw new AppError("CONFLICT", "console.errors.paymentCancelled");
    await tx
      .update(consolePayment)
      .set({ cancelledAt: new Date(), cancelReason: input.reason, cancelledBy: ctx.userId })
      .where(eq(consolePayment.id, row.id));
    await recordConsoleAudit(tx, ctx, {
      action: "payment.cancel",
      billingAccountId: row.billingAccountId,
      before: { amount: row.amount, paidOn: row.paidOn },
      reason: input.reason,
    });
  });
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

/** Credited and paid amounts of the invoice of the row (correlated: `invoice` is the outer table). */
const credited = sql<string>`coalesce((select sum(c.amount_ttc) from console.credit_note c where c.invoice_id = invoice.id), 0)::text`;
const paid = sql<string>`coalesce((select sum(p.amount) from console.payment p where p.invoice_id = invoice.id and p.cancelled_at is null), 0)::text`;

export type InvoiceSummary = {
  id: string;
  billingAccountId: string;
  legalName: string;
  number: string;
  issuedOn: CalendarDate;
  dueOn: CalendarDate;
  periodStart: CalendarDate | null;
  periodEnd: CalendarDate | null;
  totalHt: Centimes;
  totalVat: Centimes;
  totalTtc: Centimes;
  credited: Centimes;
  paid: Centimes;
  remaining: Centimes;
  state: InvoiceState;
  hasPdf: boolean;
};

/** Invoices with their derived amounts and state, latest first (an account's, or all). */
export async function listInvoices(filters: {
  billingAccountId?: string;
  state?: InvoiceState;
  q?: string;
}): Promise<InvoiceSummary[]> {
  const q = filters.q?.trim();
  const rows = await consoleDb
    .select({
      id: invoice.id,
      billingAccountId: invoice.billingAccountId,
      legalName: billingAccount.legalName,
      number: invoice.number,
      issuedOn: invoice.issuedOn,
      dueOn: invoice.dueOn,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      totalHt: invoice.totalHt,
      totalVat: invoice.totalVat,
      totalTtc: invoice.totalTtc,
      pdfKey: invoice.pdfKey,
      credited,
      paid,
    })
    .from(invoice)
    .innerJoin(billingAccount, eq(billingAccount.id, invoice.billingAccountId))
    .where(
      and(
        filters.billingAccountId
          ? eq(invoice.billingAccountId, filters.billingAccountId)
          : undefined,
        q
          ? or(ilike(invoice.number, `%${q}%`), ilike(billingAccount.legalName, `%${q}%`))
          : undefined,
      ),
    )
    .orderBy(desc(invoice.issuedOn), desc(invoice.number));
  const today = todayInAlgiers();
  return rows
    .map(({ pdfKey, ...row }) => {
      const amounts = {
        totalTtc: row.totalTtc,
        credited: BigInt(row.credited),
        paid: BigInt(row.paid),
      };
      return {
        ...row,
        ...amounts,
        remaining: invoiceRemaining(amounts),
        state: invoiceState({ ...amounts, dueOn: row.dueOn }, today),
        hasPdf: pdfKey !== null,
      };
    })
    .filter((row) => !filters.state || row.state === filters.state);
}

/** An account's invoices, credit notes and payments, for its page. */
export async function getAccountBilling(billingAccountId: string) {
  const invoices = await listInvoices({ billingAccountId });
  const creditNotes = await consoleDb
    .select({
      id: creditNote.id,
      invoiceId: creditNote.invoiceId,
      number: creditNote.number,
      issuedOn: creditNote.issuedOn,
      amountTtc: creditNote.amountTtc,
      reason: creditNote.reason,
      hasPdf: sql<boolean>`${creditNote.pdfKey} is not null`,
    })
    .from(creditNote)
    .where(eq(creditNote.billingAccountId, billingAccountId))
    .orderBy(desc(creditNote.issuedOn), desc(creditNote.number));
  const payments = await consoleDb
    .select({
      id: consolePayment.id,
      invoiceId: consolePayment.invoiceId,
      paidOn: consolePayment.paidOn,
      amount: consolePayment.amount,
      method: consolePayment.method,
      reference: consolePayment.reference,
      cancelledAt: consolePayment.cancelledAt,
      cancelReason: consolePayment.cancelReason,
      recordedBy: user.name,
    })
    .from(consolePayment)
    .leftJoin(user, eq(user.id, consolePayment.recordedBy))
    .where(eq(consolePayment.billingAccountId, billingAccountId))
    .orderBy(desc(consolePayment.paidOn), desc(consolePayment.createdAt));
  return { invoices, creditNotes, payments };
}

/** A stored invoice or credit note for the console's download: its key and file name. */
export async function consoleDocumentFile(
  id: string,
): Promise<{ storageKey: string; fileName: string } | null> {
  const [found] = await consoleDb
    .select({ key: invoice.pdfKey, number: invoice.number })
    .from(invoice)
    .where(eq(invoice.id, id));
  const [note] = found
    ? []
    : await consoleDb
        .select({ key: creditNote.pdfKey, number: creditNote.number })
        .from(creditNote)
        .where(eq(creditNote.id, id));
  const doc = found ?? note;
  return doc?.key ? { storageKey: doc.key, fileName: `${doc.number}.pdf` } : null;
}

// ── The console's overview ──────────────────────────────────────────────────────────────────

/**
 * Billing on the console's overview (CLAUDE.console.md §10): the monthly recurring revenue of the
 * active and past-due subscriptions (the syndic at the lots last measured), what remains to
 * collect, the periods to invoice within 30 days (or never invoiced), and the accounts with an
 * invoice unpaid beyond their grace (a suspension to decide).
 */
export async function getBillingOverview(today: CalendarDate = todayInAlgiers()) {
  const subscriptions = await consoleDb
    .select({
      id: subscription.id,
      billingAccountId: subscription.billingAccountId,
      legalName: billingAccount.legalName,
      status: subscription.status,
      activatedAt: subscription.activatedAt,
      price: subscription.price,
      discountBp: subscription.discountBp,
      billingPeriod: subscription.billingPeriod,
      graceDays: subscription.graceDays,
    })
    .from(subscription)
    .innerJoin(billingAccount, eq(billingAccount.id, subscription.billingAccountId))
    .where(or(eq(subscription.status, "active"), eq(subscription.status, "past_due")));
  const addons = await consoleDb
    .select({
      subscriptionId: subscriptionAddon.subscriptionId,
      price: subscriptionAddon.price,
      basis: addon.basis,
    })
    .from(subscriptionAddon)
    .leftJoin(addon, and(eq(addon.code, subscriptionAddon.addonCode), isNull(addon.archivedAt)))
    .where(isNull(subscriptionAddon.removedOn));
  const { rows: lots } = await consoleDb.execute<{ billingAccountId: string; lots: number }>(sql`
    select ao.billing_account_id as "billingAccountId", coalesce(sum(u.managed_lots), 0)::int as lots
    from console.account_organization ao
    left join lateral (
      select t.managed_lots from console.tenant_usage t
      where t.organization_id = ao.organization_id order by t.measured_on desc limit 1
    ) u on true
    group by ao.billing_account_id`);
  const lotsOf = new Map(lots.map((r) => [r.billingAccountId, r.lots]));
  let mrr = 0n;
  // Clients only: a pilot over and never activated (past due) pays nothing yet.
  for (const sub of subscriptions.filter((s) => s.activatedAt !== null)) {
    mrr += monthlyEquivalent(
      sub,
      addons
        .filter((a) => a.subscriptionId === sub.id)
        .map((a) => ({ basis: a.basis ?? "flat", price: a.price })),
      lotsOf.get(sub.billingAccountId) ?? 0,
    );
  }

  const { rows: unpaidRows } = await consoleDb.execute<{ total: string }>(sql`
    select coalesce(sum(greatest(remaining, 0)), 0)::text as total from (
      select i.total_ttc
        - coalesce((select sum(c.amount_ttc) from console.credit_note c where c.invoice_id = i.id), 0)
        - coalesce((select sum(p.amount) from console.payment p
                    where p.invoice_id = i.id and p.cancelled_at is null), 0) as remaining
      from console.invoice i
    ) invoices`);
  const unpaid = BigInt(unpaidRows[0]?.total ?? "0");

  const { rows: invoicedUntil } = await consoleDb.execute<{
    billingAccountId: string;
    until: string | null;
  }>(sql`
    select i.billing_account_id as "billingAccountId", max(l.period_end)::text as until
    from console.invoice_line l join console.invoice i on i.id = l.invoice_id
    where l.kind = 'subscription'
      and i.total_ttc > coalesce(
        (select sum(c.amount_ttc) from console.credit_note c where c.invoice_id = i.id), 0)
    group by i.billing_account_id`);
  const untilOf = new Map(invoicedUntil.map((r) => [r.billingAccountId, r.until]));
  const horizon = addDays(today, 30);
  const toInvoice = subscriptions
    .filter((s) => s.activatedAt !== null)
    .map((s) => ({ ...s, invoicedUntil: untilOf.get(s.billingAccountId) ?? null }))
    .filter((s) => s.invoicedUntil === null || s.invoicedUntil <= horizon)
    .sort((a, b) => (a.invoicedUntil ?? "").localeCompare(b.invoicedUntil ?? ""));

  const graceOf = new Map(subscriptions.map((s) => [s.billingAccountId, s]));
  const beyondGrace = new Map<string, { legalName: string; number: string; dueOn: string }>();
  for (const unpaidInvoice of await overdueInvoices(today)) {
    const sub = graceOf.get(unpaidInvoice.billingAccountId);
    if (sub?.status !== "past_due" || beyondGrace.has(unpaidInvoice.billingAccountId)) continue;
    if (addDays(unpaidInvoice.dueOn, sub.graceDays) >= today) continue;
    beyondGrace.set(unpaidInvoice.billingAccountId, {
      legalName: unpaidInvoice.legalName,
      number: unpaidInvoice.number,
      dueOn: unpaidInvoice.dueOn,
    });
  }
  return {
    mrr,
    unpaid,
    toInvoice: toInvoice.map((s) => ({
      id: s.billingAccountId,
      legalName: s.legalName,
      invoicedUntil: s.invoicedUntil,
    })),
    invoicesBeyondGrace: [...beyondGrace].map(([id, row]) => ({ id, ...row })),
  };
}
