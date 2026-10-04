import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { id, money, organizationId, softDelete, timestamps } from "./_columns";
import { chargeCategory } from "./charges";
import { residence } from "./residences";

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
    index().on(t.organizationId, t.supplierId),
    check("supplier_contract_period", sql`${t.endOn} is null or ${t.endOn} >= ${t.startOn}`),
    check("supplier_contract_amount", sql`${t.annualAmount} is null or ${t.annualAmount} >= 0`),
  ],
);
