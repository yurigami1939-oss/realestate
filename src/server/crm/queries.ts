import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { followUp, lead, leadActivity, member, project, unit, user, visit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { leadStages, openLeadStages, type LeadStage } from "@/lib/crm";
import { isUuid } from "@/lib/ids";
import { can, parseRoles } from "@/lib/permissions";
import { phoneSearchDigits } from "@/lib/phone";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { seesAllLeads, visibleLeads } from "./access";
import { LEADS_PAGE_SIZE, type LeadListParams } from "./schemas";

const assignee = alias(user, "assignee");

/** Another live lead shares one of this lead's phones. */
const isDuplicate = sql<boolean>`exists (
  select 1 from lead o
  where o.deleted_at is null and o.id <> ${lead.id}
    and (o.phone in (${lead.phone}, ${lead.phone2}) or o.phone2 in (${lead.phone}, ${lead.phone2}))
)`;

const nextFollowUpAt = sql<Date | null>`(
  select min(f.due_at) from follow_up f where f.lead_id = ${lead.id} and f.done_at is null
)`.mapWith((v: string | null) => (v === null ? null : new Date(v)));

/** An open follow-up of this lead is past due (derived, CLAUDE.md §7). */
const followUpOverdue = sql<boolean>`exists (
  select 1 from follow_up f where f.lead_id = ${lead.id} and f.done_at is null and f.due_at < now()
)`;

const ALGIERS_TODAY = sql`(now() at time zone 'Africa/Algiers')::date`;

function listConditions(ctx: TenantCtx, params: LeadListParams): SQL | undefined {
  const conditions: (SQL | undefined)[] = [isNull(lead.deletedAt), visibleLeads(ctx)];
  if (params.stage) conditions.push(eq(lead.stage, params.stage));
  if (params.source) conditions.push(eq(lead.source, params.source));
  if (params.assignee && seesAllLeads(ctx)) {
    conditions.push(
      params.assignee === "none" ? isNull(lead.assignedTo) : eq(lead.assignedTo, params.assignee),
    );
  }
  if (params.duplicates) conditions.push(isDuplicate);
  if (params.q) {
    const digits = phoneSearchDigits(params.q);
    const byName = ilike(lead.fullName, `%${params.q.replace(/[%_\\]/g, "\\$&")}%`);
    conditions.push(
      digits
        ? or(byName, ilike(lead.phone, `%${digits}%`), ilike(lead.phone2, `%${digits}%`))
        : byName,
    );
  }
  return and(...conditions);
}

/** One page of leads, most recently active first. */
export async function listLeads(ctx: TenantCtx, params: LeadListParams) {
  assertCan(ctx, "lead:read");
  const page = params.page ?? 1;
  return withTenant(ctx, async (tx) => {
    const where = listConditions(ctx, params);
    const rows = await tx
      .select({
        id: lead.id,
        fullName: lead.fullName,
        phone: lead.phone,
        phone2: lead.phone2,
        source: lead.source,
        stage: lead.stage,
        projectName: project.name,
        assigneeName: assignee.name,
        lastActivityAt: lead.lastActivityAt,
        createdAt: lead.createdAt,
        duplicate: isDuplicate,
        nextFollowUpAt,
        followUpOverdue,
      })
      .from(lead)
      .leftJoin(project, eq(project.id, lead.projectId))
      .leftJoin(assignee, eq(assignee.id, lead.assignedTo))
      .where(where)
      .orderBy(desc(lead.lastActivityAt), desc(lead.id))
      .limit(LEADS_PAGE_SIZE)
      .offset((page - 1) * LEADS_PAGE_SIZE);
    const [total] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(lead)
      .where(where);
    return { rows, total: total?.n ?? 0, page, pageSize: LEADS_PAGE_SIZE };
  });
}

export type LeadListRow = Awaited<ReturnType<typeof listLeads>>["rows"][number];

/** Lead sheet: details, timeline (including merged duplicates), visits, follow-ups, duplicates. */
export async function getLead(ctx: TenantCtx, leadId: string) {
  assertCan(ctx, "lead:read");
  if (!isUuid(leadId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ lead, projectName: project.name, assigneeName: assignee.name })
      .from(lead)
      .leftJoin(project, eq(project.id, lead.projectId))
      .leftJoin(assignee, eq(assignee.id, lead.assignedTo))
      .where(and(eq(lead.id, leadId), isNull(lead.deletedAt), visibleLeads(ctx)));
    if (!row) return null;

    const merged = await tx.select({ id: lead.id }).from(lead).where(eq(lead.mergedIntoId, leadId));
    const timelineIds = [leadId, ...merged.map((m) => m.id)];

    const activities = await tx
      .select({
        id: leadActivity.id,
        type: leadActivity.type,
        data: leadActivity.data,
        createdAt: leadActivity.createdAt,
        actorName: user.name,
      })
      .from(leadActivity)
      .leftJoin(user, eq(user.id, leadActivity.actorUserId))
      .where(inArray(leadActivity.leadId, timelineIds))
      .orderBy(desc(leadActivity.createdAt), desc(leadActivity.id));

    const visits = await tx
      .select({
        id: visit.id,
        scheduledAt: visit.scheduledAt,
        status: visit.status,
        notes: visit.notes,
        outcome: visit.outcome,
        projectName: project.name,
        unitCode: unit.code,
        agentName: user.name,
      })
      .from(visit)
      .leftJoin(project, eq(project.id, visit.projectId))
      .leftJoin(unit, eq(unit.id, visit.unitId))
      .leftJoin(user, eq(user.id, visit.agentUserId))
      .where(eq(visit.leadId, leadId))
      .orderBy(desc(visit.scheduledAt));

    const followUps = await tx
      .select({
        id: followUp.id,
        dueAt: followUp.dueAt,
        channel: followUp.channel,
        note: followUp.note,
        doneAt: followUp.doneAt,
        outcome: followUp.outcome,
        assigneeName: user.name,
        overdue: sql<boolean>`${followUp.doneAt} is null and ${followUp.dueAt} < now()`,
      })
      .from(followUp)
      .leftJoin(user, eq(user.id, followUp.assignedTo))
      .where(eq(followUp.leadId, leadId))
      .orderBy(sql`${followUp.doneAt} is not null`, asc(followUp.dueAt));

    // Commercials only learn that duplicates exist; managers see them (to merge).
    const phones = [row.lead.phone, row.lead.phone2].filter((p): p is string => p !== null);
    const duplicates = await tx
      .select({
        id: lead.id,
        fullName: lead.fullName,
        phone: lead.phone,
        stage: lead.stage,
        assigneeName: assignee.name,
        createdAt: lead.createdAt,
      })
      .from(lead)
      .leftJoin(assignee, eq(assignee.id, lead.assignedTo))
      .where(
        and(
          isNull(lead.deletedAt),
          sql`${lead.id} <> ${leadId}`,
          or(inArray(lead.phone, phones), inArray(lead.phone2, phones)),
        ),
      )
      .orderBy(asc(lead.createdAt));

    return {
      ...row.lead,
      projectName: row.projectName,
      assigneeName: row.assigneeName,
      activities,
      visits,
      followUps,
      duplicateCount: duplicates.length,
      duplicates: seesAllLeads(ctx) ? duplicates : [],
    };
  });
}

export type LeadDetail = NonNullable<Awaited<ReturnType<typeof getLead>>>;

/**
 * Open follow-ups, soonest first: a commercial's own, or everyone's for managers
 * (optionally one member's). Overdue = due before now (derived).
 */
export async function listOpenFollowUps(ctx: TenantCtx, options: { assignee?: string } = {}) {
  assertCan(ctx, "lead:read");
  const requested = options.assignee && isUuid(options.assignee) ? options.assignee : undefined;
  const owner = seesAllLeads(ctx) ? requested : ctx.userId;
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: followUp.id,
        dueAt: followUp.dueAt,
        channel: followUp.channel,
        note: followUp.note,
        leadId: lead.id,
        leadName: lead.fullName,
        leadPhone: lead.phone,
        leadStage: lead.stage,
        assigneeName: assignee.name,
        overdue: sql<boolean>`${followUp.dueAt} < now()`,
        dueToday: sql<boolean>`(${followUp.dueAt} at time zone 'Africa/Algiers')::date = ${ALGIERS_TODAY}`,
      })
      .from(followUp)
      .innerJoin(lead, eq(lead.id, followUp.leadId))
      .leftJoin(assignee, eq(assignee.id, followUp.assignedTo))
      .where(
        and(
          isNull(followUp.doneAt),
          isNull(lead.deletedAt),
          owner ? eq(followUp.assignedTo, owner) : undefined,
        ),
      )
      .orderBy(asc(followUp.dueAt))
      .limit(500),
  );
}

/** Visits between two instants (agenda). Commercials see the visits they host or whose lead they own. */
export async function listVisits(ctx: TenantCtx, range: { from: Date; to: Date }) {
  assertCan(ctx, "lead:read");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: visit.id,
        scheduledAt: visit.scheduledAt,
        status: visit.status,
        notes: visit.notes,
        leadId: lead.id,
        leadName: lead.fullName,
        leadPhone: lead.phone,
        projectName: project.name,
        unitCode: unit.code,
        agentName: assignee.name,
      })
      .from(visit)
      .innerJoin(lead, eq(lead.id, visit.leadId))
      .leftJoin(project, eq(project.id, visit.projectId))
      .leftJoin(unit, eq(unit.id, visit.unitId))
      .leftJoin(assignee, eq(assignee.id, visit.agentUserId))
      .where(
        and(
          isNull(lead.deletedAt),
          gte(visit.scheduledAt, range.from),
          lt(visit.scheduledAt, range.to),
          seesAllLeads(ctx)
            ? undefined
            : or(eq(visit.agentUserId, ctx.userId), eq(lead.assignedTo, ctx.userId)),
        ),
      )
      .orderBy(asc(visit.scheduledAt)),
  );
}

/** Kanban: open leads per stage (most recent activity first, capped), plus closed counts. */
export async function getPipeline(ctx: TenantCtx, options: { assignee?: string } = {}) {
  assertCan(ctx, "lead:read");
  const owner =
    seesAllLeads(ctx) && options.assignee && isUuid(options.assignee)
      ? options.assignee
      : undefined;
  return withTenant(ctx, async (tx) => {
    const base = and(
      isNull(lead.deletedAt),
      visibleLeads(ctx),
      owner ? eq(lead.assignedTo, owner) : undefined,
    );
    const cards = await tx
      .select({
        id: lead.id,
        fullName: lead.fullName,
        phone: lead.phone,
        stage: lead.stage,
        budget: lead.budget,
        typologies: lead.typologies,
        projectName: project.name,
        assigneeName: assignee.name,
        lastActivityAt: lead.lastActivityAt,
      })
      .from(lead)
      .leftJoin(project, eq(project.id, lead.projectId))
      .leftJoin(assignee, eq(assignee.id, lead.assignedTo))
      .where(and(base, inArray(lead.stage, [...openLeadStages])))
      .orderBy(desc(lead.lastActivityAt))
      .limit(500);
    const counts = await tx
      .select({ stage: lead.stage, n: sql<number>`count(*)::int` })
      .from(lead)
      .where(base)
      .groupBy(lead.stage);
    const countOf = (stage: LeadStage) => counts.find((c) => c.stage === stage)?.n ?? 0;
    return {
      columns: openLeadStages.map((stage) => ({
        stage,
        total: countOf(stage),
        cards: cards.filter((c) => c.stage === stage).slice(0, 50),
      })),
      closed: { won: countOf("won"), lost: countOf("lost") },
      stages: leadStages,
    };
  });
}

/** Managers: groups of live leads sharing a phone, for merging. */
export async function listDuplicateGroups(ctx: TenantCtx) {
  assertCan(ctx, "lead:merge");
  return withTenant(ctx, async (tx) => {
    const shared = await tx.execute<{ phone: string }>(sql`
      select p.phone from (
        select phone, id from lead where deleted_at is null
        union
        select phone2, id from lead where deleted_at is null and phone2 is not null
      ) p
      group by p.phone having count(distinct p.id) > 1
      order by p.phone
      limit 200`);
    const phones = shared.rows.map((r) => r.phone);
    if (phones.length === 0) return [];
    const leads = await tx
      .select({
        id: lead.id,
        fullName: lead.fullName,
        phone: lead.phone,
        phone2: lead.phone2,
        stage: lead.stage,
        source: lead.source,
        assigneeName: assignee.name,
        createdAt: lead.createdAt,
        lastActivityAt: lead.lastActivityAt,
      })
      .from(lead)
      .leftJoin(assignee, eq(assignee.id, lead.assignedTo))
      .where(
        and(isNull(lead.deletedAt), or(inArray(lead.phone, phones), inArray(lead.phone2, phones))),
      )
      .orderBy(asc(lead.createdAt));
    return phones.map((phone) => ({
      phone,
      leads: leads.filter((l) => l.phone === phone || l.phone2 === phone),
    }));
  });
}

/** Members who can hold leads (commercials and managers), for assignment selects. */
export async function listLeadOwners(ctx: TenantCtx) {
  assertCan(ctx, "lead:read");
  return withTenant(ctx, async (tx) => {
    // `member` is scoped by Better Auth, not RLS: filter on the organization explicitly.
    const rows = await tx
      .select({ userId: member.userId, role: member.role, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, ctx.orgId))
      .orderBy(asc(user.name));
    return rows
      .filter((r) => can(parseRoles(r.role), "lead:read"))
      .map((r) => ({ id: r.userId, name: r.name }));
  });
}
