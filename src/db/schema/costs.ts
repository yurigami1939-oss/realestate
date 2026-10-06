import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { costCategories } from "../../lib/costs";

import { createdAt, id, money, organizationId, softDelete, timestamps, userRef } from "./_columns";
import { file } from "./files";
import { project } from "./inventory";
import { paymentMethod } from "./sales";
import { supplier } from "./suppliers";
import { treasuryAccount } from "./treasury";

export const costCategory = pgEnum("cost_category", costCategories);

/** A line of a project's budget (bilan prévisionnel), saved as a whole. */
export const projectBudgetLine = pgTable(
  "project_budget_line",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: uuid().notNull(),
    position: integer().notNull(),
    category: costCategory().notNull(),
    label: text().notNull(),
    amount: money().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("project_budget_line_position").on(t.organizationId, t.projectId, t.position),
    foreignKey({
      name: "project_budget_line_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    check("project_budget_line_amount", sql`${t.amount} >= 0`),
  ],
);

/**
 * A contract (marché) with a contractor or a design office for a project: amount, retention
 * of guarantee, réception provisoire then définitive, the retention released at the end.
 */
export const worksContract = pgTable(
  "works_contract",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: uuid().notNull(),
    supplierId: uuid().notNull(),
    category: costCategory().notNull(),
    /** N° du marché / de la convention. */
    reference: text(),
    title: text().notNull(),
    amount: money().notNull(),
    retentionBp: integer().notNull().default(500),
    signedOn: date({ mode: "string" }).notNull(),
    plannedEndOn: date({ mode: "string" }),
    provisionalAcceptanceOn: date({ mode: "string" }),
    finalAcceptanceOn: date({ mode: "string" }),
    acceptanceNotes: text(),
    terminatedOn: date({ mode: "string" }),
    /** The retention paid back after the réception définitive. */
    retentionReleasedOn: date({ mode: "string" }),
    retentionReleased: money(),
    retentionMethod: paymentMethod(),
    retentionReference: text(),
    retentionAccountId: uuid(),
    scanFileId: uuid(),
    notes: text(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "works_contract_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    foreignKey({
      name: "works_contract_supplier_fk",
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [supplier.organizationId, supplier.id],
    }),
    foreignKey({
      name: "works_contract_account_fk",
      columns: [t.organizationId, t.retentionAccountId],
      foreignColumns: [treasuryAccount.organizationId, treasuryAccount.id],
    }),
    foreignKey({
      name: "works_contract_scan_fk",
      columns: [t.organizationId, t.scanFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.projectId),
    check("works_contract_amount", sql`${t.amount} > 0`),
    check("works_contract_retention", sql`${t.retentionBp} between 0 and 1000`),
  ],
);

/**
 * A contractor's progress invoice (situation de travaux) on a contract: its gross amount, the
 * retention kept, the net payable; editable while unpaid, read-only once paid (date, method,
 * account the money left from).
 */
export const worksInvoice = pgTable(
  "works_invoice",
  {
    id: id(),
    organizationId: organizationId(),
    contractId: uuid().notNull(),
    /** Situation n° on the contract. */
    position: integer().notNull(),
    /** The contractor's invoice number. */
    number: text(),
    invoicedOn: date({ mode: "string" }).notNull(),
    dueOn: date({ mode: "string" }),
    label: text(),
    gross: money().notNull(),
    retention: money().notNull(),
    net: money().notNull(),
    paidOn: date({ mode: "string" }),
    paymentMethod: paymentMethod(),
    paymentReference: text(),
    accountId: uuid(),
    scanFileId: uuid(),
    createdBy: userRef(),
    createdAt: createdAt(),
    updatedBy: userRef(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("works_invoice_position").on(t.organizationId, t.contractId, t.position),
    foreignKey({
      name: "works_invoice_contract_fk",
      columns: [t.organizationId, t.contractId],
      foreignColumns: [worksContract.organizationId, worksContract.id],
    }),
    foreignKey({
      name: "works_invoice_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [treasuryAccount.organizationId, treasuryAccount.id],
    }),
    foreignKey({
      name: "works_invoice_scan_fk",
      columns: [t.organizationId, t.scanFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.contractId),
    check(
      "works_invoice_amounts",
      sql`${t.gross} > 0 and ${t.retention} >= 0 and ${t.net} = ${t.gross} - ${t.retention}`,
    ),
  ],
);
