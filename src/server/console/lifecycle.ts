import "server-only";

import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { consoleDb, type ConsoleTx } from "@/db/console-client";
import { setConsoleTenant } from "@/db/console-tenant";
import { accountOrganization, billingAccount, member, subscription, user } from "@/db/schema";
import { env } from "@/env";
import { enqueue } from "@/jobs/enqueue";
import { addDays, type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { canTransition, type SubscriptionStatus } from "@/lib/subscriptions";
import { recordAudit } from "@/server/audit/record-audit";
import { invoiceOverdueEmail, pilotEndingEmail } from "@/server/email/templates";

import { recordConsoleAudit } from "./audit";
import { type OperatorCtx, systemOperator } from "./context";
import { syncEntitlement } from "./entitlements";

/** E-mailed to the gérants this many days before a pilot ends (CLAUDE.console.md §14). */
export const PILOT_WARNING_DAYS = 7;

/**
 * Moves a subscription (CLAUDE.console.md §6) in one console transaction: the subscription, the
 * entitlement of every organization of its account, the console's audit trail and a
 * `subscription.status_change` row in each organization's own audit trail. Suspending and
 * terminating need a reason; activating a pilot dates its activation.
 */
export async function changeSubscriptionStatus(
  ctx: OperatorCtx,
  input: { billingAccountId: string; to: SubscriptionStatus; reason?: string | null },
  tx?: ConsoleTx,
): Promise<{ from: SubscriptionStatus; to: SubscriptionStatus } | null> {
  const run = async (trx: ConsoleTx) => {
    const [current] = await trx
      .select({
        id: subscription.id,
        status: subscription.status,
        activatedAt: subscription.activatedAt,
      })
      .from(subscription)
      .where(eq(subscription.billingAccountId, input.billingAccountId))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND", "console.errors.accountUnknown");
    const from = current.status;
    if (from === input.to) return null;
    if (!canTransition(from, input.to)) {
      throw new AppError("INVALID_TRANSITION", "console.errors.transition");
    }
    const reason = input.reason?.trim() || null;
    if ((input.to === "suspended" || input.to === "terminated") && !reason) {
      throw new AppError("VALIDATION", "console.errors.reasonRequired", {
        fieldErrors: { reason: ["validation.required"] },
      });
    }
    await trx
      .update(subscription)
      .set({
        status: input.to,
        statusReason: reason,
        activatedAt:
          input.to === "active" ? (current.activatedAt ?? new Date()) : current.activatedAt,
      })
      .where(eq(subscription.id, current.id));
    const synced = await syncEntitlement(trx, input.billingAccountId);
    await recordConsoleAudit(trx, ctx, {
      action: "subscription.status_change",
      billingAccountId: input.billingAccountId,
      before: { status: from },
      after: { status: input.to },
      reason,
    });
    // Each organization sees it in its own audit trail (labelled « Opérateur »).
    for (const orgId of synced?.organizationIds ?? []) {
      await setConsoleTenant(trx, orgId);
      await recordAudit(
        trx as unknown as Tx,
        { orgId },
        {
          actorUserId: ctx.userId,
          action: "subscription.status_change",
          entityType: "organization",
          entityId: orgId,
          before: { status: from },
          after: { status: input.to },
          reason: reason ?? undefined,
        },
      );
    }
    return { from, to: input.to };
  };
  return tx ? run(tx) : consoleDb.transaction(run);
}

/**
 * `console.daily` (06:30 Algiers, before the reminders): pilots over and never activated go
 * `past_due` (« Pilote terminé »), so do active subscriptions with an invoice overdue; activated
 * `past_due` subscriptions with nothing overdue go back to `active`. Never suspends. The gérants
 * of pilots ending in a week and of invoices one day and one week overdue are e-mailed, once per
 * account and day; documents left without their PDF are rendered again. Returns what changed.
 */
export async function runConsoleDaily(today: CalendarDate = todayInAlgiers()) {
  const pilotsOver = await consoleDb
    .select({ billingAccountId: subscription.billingAccountId })
    .from(subscription)
    .where(and(eq(subscription.status, "pilot"), lt(subscription.pilotEndsOn, today)));
  for (const { billingAccountId } of pilotsOver) {
    await changeSubscriptionStatus(systemOperator, {
      billingAccountId,
      to: "past_due",
      reason: "pilot_over",
    });
  }
  // Invoices due before today with something unpaid (CLAUDE.console.md §6, §11).
  const overdue = await overdueInvoices(today);
  const late = new Set(overdue.map((i) => i.billingAccountId));
  const active = await consoleDb
    .select({ billingAccountId: subscription.billingAccountId })
    .from(subscription)
    .where(eq(subscription.status, "active"));
  const nowOverdue = active.filter((a) => late.has(a.billingAccountId));
  for (const { billingAccountId } of nowOverdue) {
    await changeSubscriptionStatus(systemOperator, {
      billingAccountId,
      to: "past_due",
      reason: "invoice_overdue",
    });
  }
  const pastDue = await consoleDb
    .select({ billingAccountId: subscription.billingAccountId })
    .from(subscription)
    .where(and(eq(subscription.status, "past_due"), isNotNull(subscription.activatedAt)));
  const settled = pastDue.filter((a) => !late.has(a.billingAccountId));
  for (const { billingAccountId } of settled) {
    await changeSubscriptionStatus(systemOperator, { billingAccountId, to: "active" });
  }
  // The gérants are reminded the day after the due day and a week later.
  for (const unpaid of overdue) {
    const daysLate = Math.round((Date.parse(today) - Date.parse(unpaid.dueOn)) / 86_400_000);
    if (daysLate !== 1 && daysLate !== 7) continue;
    for (const to of await accountGerants(unpaid.billingAccountId)) {
      await enqueue(
        "email.send",
        invoiceOverdueEmail({
          to,
          number: unpaid.number,
          organization: unpaid.legalName,
          remaining: BigInt(unpaid.remaining),
          dueOn: unpaid.dueOn,
          url: `${env.BETTER_AUTH_URL}/fr/settings/subscription`,
        }),
        { singletonKey: `invoice-overdue:${unpaid.id}:${to}`, singletonSeconds: 86_400 },
      );
    }
  }
  // Documents left without their PDF (a job lost): rendered again.
  const { rows: missing } = await consoleDb.execute<{
    kind: "invoice" | "credit_note";
    id: string;
  }>(sql`
    select 'invoice' as kind, id from console.invoice
    where pdf_key is null and created_at < now() - interval '10 minutes'
    union all
    select 'credit_note' as kind, id from console.credit_note
    where pdf_key is null and created_at < now() - interval '10 minutes'`);
  for (const doc of missing) {
    await enqueue("console.document", doc, { singletonKey: `${doc.kind}:${doc.id}` });
  }

  const ending = await consoleDb
    .select({
      billingAccountId: subscription.billingAccountId,
      endsOn: subscription.pilotEndsOn,
      legalName: billingAccount.legalName,
    })
    .from(subscription)
    .innerJoin(billingAccount, eq(billingAccount.id, subscription.billingAccountId))
    .where(
      and(
        eq(subscription.status, "pilot"),
        eq(subscription.pilotEndsOn, addDays(today, PILOT_WARNING_DAYS)),
      ),
    );
  let warned = 0;
  for (const account of ending) {
    for (const to of await accountGerants(account.billingAccountId)) {
      await enqueue(
        "email.send",
        pilotEndingEmail({
          to,
          organization: account.legalName,
          endsOn: account.endsOn ?? today,
          days: PILOT_WARNING_DAYS,
          url: `${env.BETTER_AUTH_URL}/fr/settings/subscription`,
        }),
        {
          singletonKey: `pilot-ending:${account.billingAccountId}:${to}`,
          singletonSeconds: 86_400,
        },
      );
      warned += 1;
    }
  }
  return {
    pastDue: pilotsOver.length + nowOverdue.length,
    reactivated: settled.length,
    warned,
  };
}

/** The invoices due before `today` with something unpaid, and what remains on each. */
export async function overdueInvoices(today: CalendarDate) {
  const { rows } = await consoleDb.execute<{
    id: string;
    billingAccountId: string;
    legalName: string;
    number: string;
    dueOn: string;
    remaining: string;
  }>(sql`
    select id, "billingAccountId", "legalName", number, "dueOn", remaining::text as remaining from (
      select i.id, i.billing_account_id as "billingAccountId", b.legal_name as "legalName",
        i.number, i.due_on::text as "dueOn",
        i.total_ttc
          - coalesce((select sum(c.amount_ttc) from console.credit_note c where c.invoice_id = i.id), 0)
          - coalesce((select sum(p.amount) from console.payment p
                      where p.invoice_id = i.id and p.cancelled_at is null), 0) as remaining
      from console.invoice i
      join console.billing_account b on b.id = i.billing_account_id
      where i.due_on < ${today}::date
    ) unpaid
    where remaining > 0
    order by "dueOn"`);
  return rows;
}

/** The e-mails of the gérants of an account's organizations, each once. */
export async function accountGerants(billingAccountId: string): Promise<string[]> {
  const organizations = consoleDb
    .select({ id: accountOrganization.organizationId })
    .from(accountOrganization)
    .where(eq(accountOrganization.billingAccountId, billingAccountId));
  const rows = await consoleDb
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(inArray(member.organizationId, organizations), eq(member.role, "owner")));
  return [...new Set(rows.map((r) => r.email))];
}
