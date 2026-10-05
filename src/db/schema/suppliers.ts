import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, money, organizationId, softDelete, timestamps } from "./_columns";
import { chargeCategory } from "./charges";
import { file } from "./files";
import { residence } from "./residences";
import { paymentMethod } from "./sales";

/**
 * Fournisseur / prestataire of the organization (lift maintenance, cleaning, security…),
 * shared by its residences (CLAUDE.md §12).
 */
export const supplier = pgTable(
  "supplier",
  {
    id: id(),
    organizationId: organizationId(),
    name: text().notNull(),
    /** What it does, free text (« Maintenance des ascenseurs »). */
    activity: text(),
    phone: text(),
    email: text(),
    address: text(),
    nif: text(),
    rcNumber: text(),
    /** Bank account (RIB) the company pays it on. */
    rib: text(),
    notes: text(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [unique().on(t.organizationId, t.id), index().on(t.organizationId, t.name)],
);

/**
 * Contrat de prestation of a supplier for a residence, optionally booked to a charge category
 * (its invoices default to it); `end_on` null = open-ended. The annual amount is informative.
 */
export const supplierContract = pgTable(
  "supplier_contract",
  {
    id: id(),
    organizationId: organizationId(),
    supplierId: uuid().notNull(),
    residenceId: uuid().notNull(),
    categoryId: uuid(),
    label: text().notNull(),
    startOn: date({ mode: "string" }).notNull(),
    endOn: date({ mode: "string" }),
    annualAmount: money(),
    notes: text(),
    /** The signed contract (scan). */
    scanFileId: uuid(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "supplier_contract_supplier_fk",
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [supplier.organizationId, supplier.id],
    }),
    foreignKey({
      name: "supplier_contract_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "supplier_contract_category_fk",
      columns: [t.organizationId, t.residenceId, t.categoryId],
      foreignColumns: [
        chargeCategory.organizationId,
        chargeCategory.residenceId,
        chargeCategory.id,
      ],
    }),
    index().on(t.organizationId, t.residenceId),
    foreignKey({
      name: "supplier_contract_scan_fk",
      columns: [t.organizationId, t.scanFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.supplierId),
    check("supplier_contract_period", sql`${t.endOn} is null or ${t.endOn} >= ${t.startOn}`),
    check("supplier_contract_amount", sql`${t.annualAmount} is null or ${t.annualAmount} >= 0`),
  ],
);

/**
 * Facture fournisseur of a residence, booked to a charge category (budget vs actual) or paid
 * from the reserve fund (works). Editable and deletable until paid; payment = date, method,
 * reference. Supplier invoice numbers are unique per supplier.
 */
export const supplierInvoice = pgTable(
  "supplier_invoice",
  {
    id: id(),
    organizationId: organizationId(),
    supplierId: uuid().notNull(),
    residenceId: uuid().notNull(),
    categoryId: uuid(),
    contractId: uuid(),
    /** The supplier's invoice number. */
    number: text().notNull(),
    invoiceOn: date({ mode: "string" }).notNull(),
    dueOn: date({ mode: "string" }),
    label: text().notNull(),
    amount: money().notNull(),
    /** Works paid from the reserve fund instead of the year's budget. */
    fromReserve: boolean().notNull().default(false),
    paidOn: date({ mode: "string" }),
    paymentMethod: paymentMethod(),
    paymentReference: text(),
    notes: text(),
    /** The invoice (scan), attached at any time, even once paid. */
    scanFileId: uuid(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "supplier_invoice_supplier_fk",
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [supplier.organizationId, supplier.id],
    }),
    foreignKey({
      name: "supplier_invoice_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "supplier_invoice_category_fk",
      columns: [t.organizationId, t.residenceId, t.categoryId],
      foreignColumns: [
        chargeCategory.organizationId,
        chargeCategory.residenceId,
        chargeCategory.id,
      ],
    }),
    foreignKey({
      name: "supplier_invoice_contract_fk",
      columns: [t.organizationId, t.contractId],
      foreignColumns: [supplierContract.organizationId, supplierContract.id],
    }),
    foreignKey({
      name: "supplier_invoice_scan_fk",
      columns: [t.organizationId, t.scanFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    uniqueIndex("supplier_invoice_number_key")
      .on(t.organizationId, t.supplierId, t.number)
      .where(sql`${t.deletedAt} is null`),
    index().on(t.organizationId, t.residenceId, t.invoiceOn),
    check("supplier_invoice_amount", sql`${t.amount} > 0`),
    check("supplier_invoice_booking", sql`${t.fromReserve} or ${t.categoryId} is not null`),
    check(
      "supplier_invoice_payment",
      sql`(${t.paidOn} is null) = (${t.paymentMethod} is null) and (${t.paymentMethod} is null or ${t.paymentMethod} <> 'bank_loan')`,
    ),
  ],
);
