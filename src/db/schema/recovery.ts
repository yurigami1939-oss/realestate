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
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { recoveryStepKinds } from "../../lib/recovery";

import { createdAt, id, instant, money, organizationId, timestamps, userRef } from "./_columns";
import { residence, residenceUnit } from "./residences";

export const recoveryStepKind = pgEnum("recovery_step_kind", recoveryStepKinds);

/**
 * Dossier de recouvrement of a unit's charge arrears (CLAUDE.md §7 Residence charges): opened
 * while calls are overdue, closed (settled or abandoned) with a reason; one open per unit.
 */
export const chargeRecovery = pgTable(
  "charge_recovery",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    unitId: uuid().notNull(),
    openedOn: date({ mode: "string" }).notNull(),
    closedOn: date({ mode: "string" }),
    closeReason: text(),
    ...timestamps(),
    createdBy: userRef().notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "charge_recovery_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "charge_recovery_unit_fk",
      columns: [t.residenceId, t.unitId],
      foreignColumns: [residenceUnit.residenceId, residenceUnit.unitId],
    }),
    uniqueIndex("charge_recovery_open_key")
      .on(t.organizationId, t.residenceId, t.unitId)
      .where(sql`${t.closedOn} is null`),
    check("charge_recovery_closed", sql`(${t.closedOn} is null) = (${t.closeReason} is null)`),
  ],
);

/** What was done in a recovery file, by day: append-only. */
export const chargeRecoveryStep = pgTable(
  "charge_recovery_step",
  {
    id: id(),
    organizationId: organizationId(),
    recoveryId: uuid().notNull(),
    kind: recoveryStepKind().notNull(),
    doneOn: date({ mode: "string" }).notNull(),
    note: text(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "charge_recovery_step_recovery_fk",
      columns: [t.organizationId, t.recoveryId],
      foreignColumns: [chargeRecovery.organizationId, chargeRecovery.id],
    }),
    index().on(t.organizationId, t.recoveryId, t.doneOn),
  ],
);

/**
 * Échéancier d'apurement agreed with the co-owner: the arrears spread over monthly parts
 * (`lines`, frozen); its progress is what the unit paid since (`paid_before` = the unit's paid
 * total when it was made). One live plan per file; cancelled with a reason, never edited.
 */
export const chargeRepaymentPlan = pgTable(
  "charge_repayment_plan",
  {
    id: id(),
    organizationId: organizationId(),
    recoveryId: uuid().notNull(),
    total: money().notNull(),
    months: integer().notNull(),
    firstDueOn: date({ mode: "string" }).notNull(),
    lines: jsonb().$type<{ dueOn: string; amount: string }[]>().notNull(),
    paidBefore: money().notNull(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    cancelledAt: instant(),
    cancellationReason: text(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "charge_repayment_plan_recovery_fk",
      columns: [t.organizationId, t.recoveryId],
      foreignColumns: [chargeRecovery.organizationId, chargeRecovery.id],
    }),
    uniqueIndex("charge_repayment_plan_live_key")
      .on(t.organizationId, t.recoveryId)
      .where(sql`${t.cancelledAt} is null`),
    check("charge_repayment_plan_amounts", sql`${t.total} > 0 and ${t.months} between 1 and 24`),
  ],
);
