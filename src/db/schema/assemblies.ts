import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  assemblyKinds,
  assemblyStatuses,
  attendanceKinds,
  majorities,
  voteChoices,
} from "../../lib/assemblies";

import { id, instant, organizationId, timestamps } from "./_columns";
import { file } from "./files";
import { residence, residenceUnit } from "./residences";

export const assemblyKind = pgEnum("assembly_kind", assemblyKinds);
export const assemblyStatus = pgEnum("assembly_status", assemblyStatuses);
export const majority = pgEnum("majority", majorities);
export const assemblyAttendanceKind = pgEnum("assembly_attendance_kind", attendanceKinds);
export const voteChoice = pgEnum("vote_choice", voteChoices);

/**
 * Assemblée générale of a residence's co-owners: agenda (resolutions), bilingual convocation,
 * attendance with proxies, votes by tantièmes and bilingual minutes (CLAUDE.md §12).
 */
export const generalAssembly = pgTable(
  "general_assembly",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    kind: assemblyKind().notNull().default("ordinary"),
    heldOn: date({ mode: "string" }).notNull(),
    /** "18:30" */
    startTime: text().notNull(),
    place: text().notNull(),
    status: assemblyStatus().notNull().default("draft"),
    /** Total tantièmes of the residence, frozen when the assembly closes. */
    totalShares: integer(),
    chairName: text(),
    secretaryName: text(),
    notes: text(),
    convenedAt: instant(),
    closedAt: instant(),
    convocationFileId: uuid(),
    minutesFileId: uuid(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("general_assembly_residence_key").on(t.organizationId, t.residenceId, t.id),
    foreignKey({
      name: "general_assembly_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "general_assembly_convocation_fk",
      columns: [t.organizationId, t.convocationFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    foreignKey({
      name: "general_assembly_minutes_fk",
      columns: [t.organizationId, t.minutesFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.residenceId, t.heldOn),
    check(
      "general_assembly_closed",
      sql`(${t.status} = 'closed') = (${t.closedAt} is not null and ${t.totalShares} is not null)`,
    ),
  ],
);

/** Résolution on the agenda, with the majority it needs; results are frozen at closing. */
export const assemblyResolution = pgTable(
  "assembly_resolution",
  {
    id: id(),
    organizationId: organizationId(),
    assemblyId: uuid().notNull(),
    position: integer().notNull(),
    title: text().notNull(),
    titleAr: text(),
    description: text(),
    majority: majority().notNull().default("simple"),
    /** Tantièmes for / against / abstaining and the result, frozen at closing. */
    sharesFor: integer(),
    sharesAgainst: integer(),
    sharesAbstain: integer(),
    adopted: boolean(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("assembly_resolution_assembly_key").on(t.organizationId, t.assemblyId, t.id),
    foreignKey({
      name: "assembly_resolution_assembly_fk",
      columns: [t.organizationId, t.assemblyId],
      foreignColumns: [generalAssembly.organizationId, generalAssembly.id],
    }),
    index().on(t.organizationId, t.assemblyId),
  ],
);

/** Presence of each unit's co-owner: present, represented (proxy) or absent; shares frozen. */
export const assemblyAttendance = pgTable(
  "assembly_attendance",
  {
    organizationId: organizationId(),
    assemblyId: uuid().notNull(),
    residenceId: uuid().notNull(),
    unitId: uuid().notNull(),
    kind: assemblyAttendanceKind().notNull(),
    /** Co-owner as on the attendance sheet. */
    coOwnerName: text(),
    /** Mandataire of a represented co-owner. */
    proxyName: text(),
    share: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.assemblyId, t.unitId] }),
    foreignKey({
      name: "assembly_attendance_assembly_fk",
      columns: [t.organizationId, t.residenceId, t.assemblyId],
      foreignColumns: [
        generalAssembly.organizationId,
        generalAssembly.residenceId,
        generalAssembly.id,
      ],
    }),
    foreignKey({
      name: "assembly_attendance_unit_fk",
      columns: [t.residenceId, t.unitId],
      foreignColumns: [residenceUnit.residenceId, residenceUnit.unitId],
    }),
    check("assembly_attendance_proxy", sql`${t.kind} = 'represented' or ${t.proxyName} is null`),
  ],
);

/** Vote of a present or represented unit on a resolution. */
export const assemblyVote = pgTable(
  "assembly_vote",
  {
    organizationId: organizationId(),
    assemblyId: uuid().notNull(),
    resolutionId: uuid().notNull(),
    unitId: uuid().notNull(),
    choice: voteChoice().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.resolutionId, t.unitId] }),
    foreignKey({
      name: "assembly_vote_resolution_fk",
      columns: [t.organizationId, t.assemblyId, t.resolutionId],
      foreignColumns: [
        assemblyResolution.organizationId,
        assemblyResolution.assemblyId,
        assemblyResolution.id,
      ],
    }),
    foreignKey({
      name: "assembly_vote_attendance_fk",
      columns: [t.assemblyId, t.unitId],
      foreignColumns: [assemblyAttendance.assemblyId, assemblyAttendance.unitId],
    }),
  ],
);
