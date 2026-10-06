import "server-only";

import { asc, eq } from "drizzle-orm";
import type { z } from "zod";

import { db } from "@/db/client";
import { installment, member, organization, reminderLetter, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { env } from "@/env";
import { enqueue, enqueueInTx } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { parseRoles } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { computeStatement } from "@/lib/statement";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { overdueDigestEmail } from "@/server/email/templates";
import { loadCompanyProfile, loadSalesSettings } from "@/server/organizations/settings";
import { loadVisibleReservation } from "@/server/sales/access";
import { paidTotals } from "@/server/sales/sale-queries";
import { notifyPaymentReminder } from "@/server/whatsapp/notify";

import { loadOverdueSales } from "./overdue";
import type { issueReminderSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/**
 * Issues a reminder letter for the overdue installments of a sale (CLAUDE.md §12): the lines,
 * the overdue total and the computed penalties (shown, never charged) are kept as printed;
 * the bilingual PDF is rendered by the worker. A formal notice (mise en demeure, `sale:withdraw`)
 * gives at least the company's notice delay and is audited: unanswered, it opens the way to a
 * termination for non-payment.
 */
export async function issueReminderLetter(ctx: TenantCtx, input: In<typeof issueReminderSchema>) {
  assertCan(ctx, input.kind === "formal_notice" ? "sale:withdraw" : "sale:remind");
  const today = todayInAlgiers();
  if (input.payBy < today) {
    throw new AppError("VALIDATION", "collections.errors.payByPast", {
      fieldErrors: { payBy: ["collections.errors.payByPast"] },
    });
  }
  return withTenant(ctx, async (tx) => {
    const sale = await loadVisibleReservation(tx, ctx, input.reservationId, { forUpdate: true });
    if (sale.status === "withdrawn") throw new AppError("CONFLICT", "sales.errors.closed");
    const settings = await loadSalesSettings(tx, ctx.orgId);
    if (input.kind === "formal_notice" && input.payBy < addDays(today, settings.formalNoticeDays)) {
      throw new AppError("VALIDATION", "collections.errors.noticeTooShort", {
        fieldErrors: { payBy: ["collections.errors.noticeTooShort"] },
      });
    }
    const installments = await tx
      .select({
        position: installment.position,
        label: installment.label,
        amount: installment.amount,
        dueOn: installment.dueOn,
      })
      .from(installment)
      .where(eq(installment.reservationId, sale.id))
      .orderBy(asc(installment.position));
    const paid = (await paidTotals(tx, [sale.id])).get(sale.id) ?? 0n;
    const statement = computeStatement(installments, paid, today, {
      monthlyRateBp: settings.penaltyMonthlyRateBp,
      graceDays: settings.penaltyGraceDays,
      capBp: settings.penaltyCapBp,
    });
    if (statement.overdue === 0n) {
      throw new AppError("CONFLICT", "collections.errors.nothingOverdue");
    }
    const lines = statement.lines.flatMap((line) =>
      line.state === "overdue" && line.dueOn
        ? [
            {
              position: line.position,
              label: line.label,
              dueOn: line.dueOn,
              remaining: line.remaining.toString(),
              daysLate: line.daysLate,
              penalty: line.penalty.toString(),
            },
          ]
        : [],
    );
    const [row] = await tx
      .insert(reminderLetter)
      .values({
        organizationId: ctx.orgId,
        reservationId: sale.id,
        kind: input.kind,
        issuedBy: ctx.userId,
        overdue: statement.overdue,
        penalties: statement.penalties,
        lines,
        payBy: input.payBy,
      })
      .returning({ id: reminderLetter.id });
    if (!row) throw new Error("issueReminderLetter: no row returned");
    if (input.kind === "formal_notice") {
      await recordAudit(tx, ctx, {
        actorUserId: ctx.userId,
        action: "reservation.formal_notice",
        entityType: "reservation",
        entityId: sale.id,
        after: { overdue: statement.overdue, payBy: input.payBy },
      });
    }
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "reminder_letter", id: row.id },
      { singletonKey: `reminder_letter:${row.id}` },
    );
    await notifyPaymentReminder(tx, ctx, sale.id, {
      overdue: statement.overdue,
      payBy: input.payBy,
    });
    return { id: row.id, overdue: statement.overdue };
  });
}

/**
 * At most one job per key and day: on standard queues pg-boss only deduplicates throttled
 * jobs (`singletonSeconds`), whatever their state, until the next slot (UTC day).
 */
const onceADay = (singletonKey: string) => ({ singletonKey, singletonSeconds: 86_400 });

/** Job `reminders.daily` (08:00 Algiers): one digest job per organization for today. */
export async function queueOverdueDigests(): Promise<number> {
  const date = todayInAlgiers();
  // `organization` is Better Auth's tenant table: no RLS, every tenant is listed.
  const tenants = await db.select({ id: organization.id }).from(organization);
  for (const { id } of tenants) {
    await enqueue("reminders.digest", { organizationId: id, date }, onceADay(`digest:${id}`));
  }
  return tenants.length;
}

/** Roles that receive the daily overdue digest (CLAUDE.md §12). */
const digestRoles = new Set(["cashier", "sales_manager"]);

/**
 * Job `reminders.digest`: e-mails the organization's overdue sales to its cashiers and sales
 * managers (nothing is sent when nothing is overdue). Returns the number of e-mails queued.
 */
export async function sendOverdueDigest(organizationId: string, date: string): Promise<number> {
  return withTenant({ orgId: organizationId }, async (tx) => {
    const overdue = await loadOverdueSales(tx, organizationId);
    if (overdue.length === 0) return 0;
    // `member` has no RLS (Better Auth): always filter on the organization.
    const members = await tx
      .select({ email: user.email, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, organizationId));
    const recipients = [
      ...new Set(
        members
          .filter((m) => parseRoles(m.role).some((role) => digestRoles.has(role)))
          .map((m) => m.email),
      ),
    ];
    const company = await loadCompanyProfile(tx, organizationId);
    for (const to of recipients) {
      await enqueueInTx(
        tx,
        "email.send",
        overdueDigestEmail({
          to,
          organization: company.name,
          date,
          sales: overdue,
          url: `${env.BETTER_AUTH_URL}/fr/sales/overdue`,
        }),
        onceADay(`digest:${organizationId}:${to}`),
      );
    }
    return recipients.length;
  });
}
