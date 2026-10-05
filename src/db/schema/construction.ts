import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { id, organizationId, softDelete, timestamps } from "./_columns";
import { building, project } from "./inventory";

/**
 * Compte rendu d'avancement des travaux of a project (module 4): a dated note, the progress
 * of the buildings it reports on and its site photos (`file` rows of entity
 * `construction_report`). Published reports are shown to the project's buyers (portal).
 */
export const constructionReport = pgTable(
  "construction_report",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: uuid().notNull(),
    reportedOn: date({ mode: "string" }).notNull(),
    title: text().notNull(),
    titleAr: text(),
    body: text(),
    bodyAr: text(),
    /** Shown to the project's buyers on the portal. */
    published: boolean().notNull().default(true),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.projectId, t.id),
    foreignKey({
      name: "construction_report_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    index().on(t.organizationId, t.projectId, t.reportedOn),
  ],
);

/**
 * Progress of a building (percent of the works done) as of a report. A building's current
 * progress is the one of its latest live report.
 */
export const buildingProgress = pgTable(
  "building_progress",
  {
    organizationId: organizationId(),
    reportId: uuid().notNull(),
    /** Denormalized so the building can only be one of the report's project (composite FKs). */
    projectId: uuid().notNull(),
    buildingId: uuid().notNull(),
    percent: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.reportId, t.buildingId] }),
    foreignKey({
      name: "building_progress_report_fk",
      columns: [t.organizationId, t.projectId, t.reportId],
      foreignColumns: [
        constructionReport.organizationId,
        constructionReport.projectId,
        constructionReport.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "building_progress_building_fk",
      columns: [t.organizationId, t.projectId, t.buildingId],
      foreignColumns: [building.organizationId, building.projectId, building.id],
    }),
    index().on(t.organizationId, t.buildingId),
    check("building_progress_percent", sql`${t.percent} between 0 and 100`),
  ],
);
