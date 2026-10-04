import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import {
  ticketCategories,
  ticketEventKinds,
  ticketPriorities,
  ticketStatuses,
} from "../../lib/tickets";

import { createdAt, id, instant, organizationId, timestamps, userRef } from "./_columns";
import { residence, residenceUnit, resident } from "./residences";
import { staffMember } from "./staff";
import { supplier } from "./suppliers";

export const ticketCategory = pgEnum("ticket_category", ticketCategories);
export const ticketPriority = pgEnum("ticket_priority", ticketPriorities);
export const ticketStatus = pgEnum("ticket_status", ticketStatuses);
export const ticketEventKind = pgEnum("ticket_event_kind", ticketEventKinds);

/**
 * Réclamation of a residence (a unit or the common areas), reported by a resident or the staff,
 * assigned to an agent of the residence or a supplier (CLAUDE.md §12). Its history is in
 * `ticket_event`.
 */
export const ticket = pgTable(
  "ticket",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    /** Null: common areas. */
    unitId: uuid(),
    /** The co-owner or occupant who reported it, when known. */
    residentId: uuid(),
    reporterName: text(),
    title: text().notNull(),
    description: text(),
    category: ticketCategory().notNull(),
    priority: ticketPriority().notNull().default("normal"),
    status: ticketStatus().notNull().default("open"),
    assignedStaffId: uuid(),
    assignedSupplierId: uuid(),
    resolvedAt: instant(),
    closedAt: instant(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "ticket_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "ticket_unit_fk",
      columns: [t.residenceId, t.unitId],
      foreignColumns: [residenceUnit.residenceId, residenceUnit.unitId],
    }),
    foreignKey({
      name: "ticket_resident_fk",
      columns: [t.organizationId, t.residentId],
      foreignColumns: [resident.organizationId, resident.id],
    }),
    foreignKey({
      name: "ticket_staff_fk",
      columns: [t.organizationId, t.residenceId, t.assignedStaffId],
      foreignColumns: [staffMember.organizationId, staffMember.residenceId, staffMember.id],
    }),
    foreignKey({
      name: "ticket_supplier_fk",
      columns: [t.organizationId, t.assignedSupplierId],
      foreignColumns: [supplier.organizationId, supplier.id],
    }),
    index().on(t.organizationId, t.residenceId, t.status),
    index().on(t.organizationId, t.status),
    check("ticket_assignee", sql`${t.assignedStaffId} is null or ${t.assignedSupplierId} is null`),
  ],
);

/** Append-only history of a ticket: creation, status changes, assignments, comments. */
export const ticketEvent = pgTable(
  "ticket_event",
  {
    id: id(),
    organizationId: organizationId(),
    ticketId: uuid().notNull(),
    kind: ticketEventKind().notNull(),
    fromStatus: ticketStatus(),
    toStatus: ticketStatus(),
    /** Assignee name, as it was (agent or supplier). */
    assignee: text(),
    comment: text(),
    actorUserId: userRef(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "ticket_event_ticket_fk",
      columns: [t.organizationId, t.ticketId],
      foreignColumns: [ticket.organizationId, ticket.id],
    }),
    index().on(t.organizationId, t.ticketId),
  ],
);
