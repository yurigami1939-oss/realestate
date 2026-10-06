import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  financingModes,
  followUpChannels,
  leadActivityTypes,
  leadSources,
  leadStages,
  lostReasons,
  visitStatuses,
} from "../../lib/crm";

import {
  createdAt,
  id,
  instant,
  money,
  organizationId,
  softDelete,
  timestamps,
  updatedAt,
  userRef,
} from "./_columns";
import { project, typology, unit } from "./inventory";

export const leadSource = pgEnum("lead_source", leadSources);
export const leadStage = pgEnum("lead_stage", leadStages);
export const lostReason = pgEnum("lost_reason", lostReasons);
export const financingMode = pgEnum("financing_mode", financingModes);
export const visitStatus = pgEnum("visit_status", visitStatuses);
export const followUpChannel = pgEnum("follow_up_channel", followUpChannels);
export const leadActivityType = pgEnum("lead_activity_type", leadActivityTypes);

/**
 * Prospect. Phones are E.164. The same phone may exist on several leads (flagged as possible
 * duplicates, merged by a manager: `mergedIntoId`). A commercial sees the leads assigned to them.
 */
export const lead = pgTable(
  "lead",
  {
    id: id(),
    organizationId: organizationId(),
    fullName: text().notNull(),
    phone: text().notNull(),
    phone2: text(),
    email: text(),
    city: text(),
    source: leadSource().notNull(),
    sourceDetail: text(),
    stage: leadStage().notNull().default("new"),
    lostReason: lostReason(),
    lostNote: text(),
    /** Interest: project, typologies, budget, financing. */
    projectId: uuid(),
    typologies: typology()
      .array()
      .notNull()
      .default(sql`'{}'`),
    budget: money(),
    financing: financingMode(),
    notes: text(),
    assignedTo: userRef(),
    mergedIntoId: uuid(),
    lastActivityAt: instant().notNull().defaultNow(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "lead_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    foreignKey({
      name: "lead_merged_into_fk",
      columns: [t.organizationId, t.mergedIntoId],
      foreignColumns: [t.organizationId, t.id],
    }),
    index().on(t.organizationId, t.phone),
    index().on(t.organizationId, t.phone2),
    index().on(t.organizationId, t.assignedTo, t.stage),
    index().on(t.organizationId, t.lastActivityAt),
  ],
);

/** Lead timeline (append-only): what happened, who did it, event details. */
export const leadActivity = pgTable(
  "lead_activity",
  {
    id: id(),
    organizationId: organizationId(),
    leadId: uuid().notNull(),
    type: leadActivityType().notNull(),
    actorUserId: userRef(),
    data: jsonb().$type<Record<string, string | number | boolean | null>>(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "lead_activity_lead_fk",
      columns: [t.organizationId, t.leadId],
      foreignColumns: [lead.organizationId, lead.id],
    }),
    index().on(t.organizationId, t.leadId, t.createdAt),
  ],
);

/** Visite (of a project, optionally a given unit). */
export const visit = pgTable(
  "visit",
  {
    id: id(),
    organizationId: organizationId(),
    leadId: uuid().notNull(),
    projectId: uuid(),
    unitId: uuid(),
    scheduledAt: instant().notNull(),
    status: visitStatus().notNull().default("planned"),
    /** Commercial who hosts the visit. */
    agentUserId: userRef(),
    notes: text(),
    outcome: text(),
    completedAt: instant(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "visit_lead_fk",
      columns: [t.organizationId, t.leadId],
      foreignColumns: [lead.organizationId, lead.id],
    }),
    foreignKey({
      name: "visit_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    foreignKey({
      name: "visit_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    index().on(t.organizationId, t.scheduledAt),
    index().on(t.organizationId, t.leadId),
  ],
);

/** Relance: something to do for a lead by a given time. Overdue is derived, never stored. */
export const followUp = pgTable(
  "follow_up",
  {
    id: id(),
    organizationId: organizationId(),
    leadId: uuid().notNull(),
    dueAt: instant().notNull(),
    channel: followUpChannel().notNull().default("call"),
    note: text(),
    assignedTo: userRef().notNull(),
    doneAt: instant(),
    doneBy: userRef(),
    outcome: text(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "follow_up_lead_fk",
      columns: [t.organizationId, t.leadId],
      foreignColumns: [lead.organizationId, lead.id],
    }),
    index().on(t.organizationId, t.assignedTo, t.dueAt),
    index().on(t.organizationId, t.leadId),
  ],
);

/**
 * Objectif mensuel d'un commercial, in activity counts (CLAUDE.md §12). Reservation and sales
 * targets come with module 3.
 */
export const salesTarget = pgTable(
  "sales_target",
  {
    organizationId: organizationId(),
    userId: userRef().notNull(),
    /** First day of the month (Algiers calendar). */
    month: date({ mode: "string" }).notNull(),
    visits: integer().notNull().default(0),
    quotations: integer().notNull().default(0),
    /** Reservations signed and VSP signed in the month (module 3). */
    reservations: integer().notNull().default(0),
    sales: integer().notNull().default(0),
    updatedAt: updatedAt(),
    updatedBy: userRef(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId, t.month] }),
    check(
      "sales_target_counts",
      sql`${t.visits} >= 0 and ${t.quotations} >= 0 and ${t.reservations} >= 0 and ${t.sales} >= 0`,
    ),
    check("sales_target_month", sql`extract(day from ${t.month}) = 1`),
  ],
);

/**
 * Marketing spend of a month on a lead source (ads, Ouedkniss listings, a stand…), entered by
 * the commercial management: the reports compare it with the leads and sales of the source.
 */
export const marketingSpend = pgTable(
  "marketing_spend",
  {
    organizationId: organizationId(),
    /** First day of the month (Algiers calendar). */
    month: date({ mode: "string" }).notNull(),
    source: leadSource().notNull(),
    amount: money().notNull(),
    notes: text(),
    updatedAt: updatedAt(),
    updatedBy: userRef(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.month, t.source] }),
    check("marketing_spend_amount", sql`${t.amount} > 0`),
    check("marketing_spend_month", sql`extract(day from ${t.month}) = 1`),
  ],
);

/**
 * A key a website or an automation (Zapier, Make: Facebook Lead Ads…) uses to send leads to
 * `POST /api/v1/organizations/{orgId}/leads` (CLAUDE.md §7 CRM). Only its SHA-256 is kept;
 * leads are created as the member who made the key. Revoked, never deleted.
 */
export const leadCaptureKey = pgTable(
  "lead_capture_key",
  {
    id: id(),
    organizationId: organizationId(),
    name: text().notNull(),
    /** First characters of the key, to recognise it in the list. */
    prefix: text().notNull(),
    keyHash: text().notNull(),
    /** Source and project given to the leads that do not say. */
    source: leadSource().notNull().default("website"),
    projectId: uuid(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    lastUsedAt: instant(),
    /** Calls of the current minute (rate limit). */
    windowStart: instant(),
    windowCount: integer().notNull().default(0),
    revokedAt: instant(),
    revokedBy: userRef(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("lead_capture_key_hash").on(t.keyHash),
    foreignKey({
      name: "lead_capture_key_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
  ],
);
