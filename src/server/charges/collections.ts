import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { chargeReminder, member, residence, residenceUnit, unit, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { env } from "@/env";
import { enqueueInTx } from "@/jobs/enqueue";
import { callPeriodLabels } from "@/lib/charges";
import { type CalendarDate, todayInAlgiers } from "@/lib/dates";
import type { RecoveryStepKind } from "@/lib/recovery";
import { parseRoles } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { chargesDigestEmail } from "@/server/email/templates";
import { loadCompanyProfile } from "@/server/organizations/settings";
import { loadResidence } from "@/server/residences/service";
import { notifyChargeReminder } from "@/server/whatsapp/notify";

import { chargeStatement, liveCalls, paidByUnit } from "./accounts";
import { recoveryStatus } from "./recovery";
import { mainCoOwners } from "./calls";
import type { issueChargeReminderSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

export type OverdueCharge = {
  residenceId: string;
  residenceName: string;
  unitId: string;
  code: string;
  coOwner: string | null;
  phone: string | null;
  overdue: bigint;
  /** Due date of the oldest unpaid call, and the days since. */
  oldestDueOn: CalendarDate;
  daysLate: number;
  lastReminderAt: Date | null;
  /** The open recovery file: its last step and whether its repayment plan is late. */
  recovery: { lastStep: RecoveryStepKind | null; planLate: boolean | null } | null;
};

/**
 * Units with overdue charges in every live residence (derived: calls due before today not
 * covered by the payments, CLAUDE.md §7), most late first. Reminders only: no penalties.
 */
export async function loadOverdueCharges(tx: Tx): Promise<OverdueCharge[]> {
  const today = todayInAlgiers();
  const residences = await tx
    .select({ id: residence.id, name: residence.name })
    .from(residence)
    .where(isNull(residence.deletedAt))
    .orderBy(asc(residence.name));
  const rows: OverdueCharge[] = [];
  for (const home of residences) {
    const calls = await liveCalls(tx, home.id);
    if (!calls.some((c) => c.dueOn < today)) continue;
    const paid = await paidByUnit(tx, home.id);
    const owners = await mainCoOwners(tx, home.id, today);
    const files = await recoveryStatus(tx, home.id, paid);
    const codes = new Map(
      (
        await tx
          .select({ unitId: residenceUnit.unitId, code: unit.code })
          .from(residenceUnit)
          .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
          .where(eq(residenceUnit.residenceId, home.id))
      ).map((u) => [u.unitId, u.code]),
    );
    const reminders = new Map(
      (
        await tx
          .select({
            unitId: chargeReminder.unitId,
            last: sql<string>`max(${chargeReminder.issuedAt})`.mapWith(String),
          })
          .from(chargeReminder)
          .where(eq(chargeReminder.residenceId, home.id))
          .groupBy(chargeReminder.unitId)
      ).map((r) => [r.unitId, new Date(r.last)]),
    );
    for (const unitId of new Set(calls.map((c) => c.unitId))) {
      const statement = chargeStatement(
        calls.filter((c) => c.unitId === unitId),
        paid.get(unitId) ?? 0n,
        today,
      );
      const oldest = statement.lines.find((l) => l.state === "overdue");
      if (statement.overdue === 0n || !oldest?.dueOn) continue;
      const owner = owners.get(unitId);
      rows.push({
        residenceId: home.id,
        residenceName: home.name,
        unitId,
        code: codes.get(unitId) ?? "—",
        coOwner: owner ? `${owner.lastName} ${owner.firstName}` : null,
        phone: owner?.phone ?? null,
        overdue: statement.overdue,
        oldestDueOn: oldest.dueOn,
        daysLate: oldest.daysLate,
        lastReminderAt: reminders.get(unitId) ?? null,
        recovery: files.get(unitId) ?? null,
      });
    }
  }
  return rows.sort((a, b) =>
    b.daysLate !== a.daysLate ? b.daysLate - a.daysLate : a.overdue < b.overdue ? 1 : -1,
  );
}

/**
 * Issues a reminder letter for a unit's overdue charges (`charge:remind`): the overdue calls
 * and their total are kept as printed, addressed to the main co-owner today; the bilingual PDF
 * is rendered by the worker.
 */
export async function issueChargeReminder(
  ctx: TenantCtx,
  input: In<typeof issueChargeReminderSchema>,
) {
  assertCan(ctx, "charge:remind");
  const today = todayInAlgiers();
  if (input.payBy < today) {
    throw new AppError("VALIDATION", "collections.errors.payByPast", {
      fieldErrors: { payBy: ["collections.errors.payByPast"] },
    });
  }
  return withTenant(ctx, async (tx) => {
    const home = await loadResidence(tx, input.residenceId);
    const [member_] = await tx
      .select({ unitId: residenceUnit.unitId })
      .from(residenceUnit)
      .where(and(eq(residenceUnit.residenceId, home.id), eq(residenceUnit.unitId, input.unitId)))
      .for("update");
    if (!member_) throw new AppError("NOT_FOUND");
    const calls = await liveCalls(tx, home.id, [input.unitId]);
    const paid = (await paidByUnit(tx, home.id, [input.unitId])).get(input.unitId) ?? 0n;
    const statement = chargeStatement(calls, paid, today);
    if (statement.overdue === 0n) {
      throw new AppError("CONFLICT", "charges.errors.nothingOverdue");
    }
    const lines = statement.lines.flatMap((line) =>
      line.state === "overdue" && line.dueOn
        ? [
            {
              number: line.number,
              period: callPeriodLabels(line),
              dueOn: line.dueOn,
              remaining: line.remaining.toString(),
              daysLate: line.daysLate,
            },
          ]
        : [],
    );
    const owner = (await mainCoOwners(tx, home.id, today)).get(input.unitId);
    const [row] = await tx
      .insert(chargeReminder)
      .values({
        organizationId: ctx.orgId,
        residenceId: home.id,
        unitId: input.unitId,
        issuedBy: ctx.userId,
        overdue: statement.overdue,
        lines,
        payBy: input.payBy,
        addresseeName: owner ? `${owner.lastName} ${owner.firstName}` : null,
        addresseeNameAr: owner
          ? [owner.lastNameAr, owner.firstNameAr].filter(Boolean).join(" ") || null
          : null,
        addresseeAddress: owner?.address ?? null,
      })
      .returning({ id: chargeReminder.id });
    if (!row) throw new Error("issueChargeReminder: no row returned");
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "charge_reminder", id: row.id },
      { singletonKey: `charge_reminder:${row.id}` },
    );
    await notifyChargeReminder(tx, ctx, {
      residenceId: home.id,
      unitId: input.unitId,
      overdue: statement.overdue,
      payBy: input.payBy,
    });
    return { id: row.id, overdue: statement.overdue };
  });
}

/** Roles that receive the daily overdue charges digest (CLAUDE.md §12). */
const digestRoles = new Set(["property_manager", "cashier"]);

/**
 * Daily `reminders.digest` job, charges part: e-mails the organization's overdue charges to its
 * property managers and cashiers (nothing is sent when nothing is overdue), at most once a day
 * per recipient. Returns the number of e-mails queued.
 */
export async function sendChargesDigest(organizationId: string, date: string): Promise<number> {
  return withTenant({ orgId: organizationId }, async (tx) => {
    const overdue = await loadOverdueCharges(tx);
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
        chargesDigestEmail({
          to,
          organization: company.name,
          date,
          units: overdue,
          url: `${env.BETTER_AUTH_URL}/fr/residences/overdue`,
        }),
        { singletonKey: `charges-digest:${organizationId}:${to}`, singletonSeconds: 86_400 },
      );
    }
    return recipients.length;
  });
}
