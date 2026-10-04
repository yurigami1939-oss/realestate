import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import {
  budget,
  budgetLine,
  building,
  chargeCall,
  chargeCategory,
  chargeCategoryUnit,
  chargePayment,
  chargePeriod,
  project,
  residence,
  residenceUnit,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { buildChargeCalls } from "@/lib/charges";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { sumCentimes } from "@/lib/money";
import { callsPerYear } from "@/lib/residences";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { chargeStatement, liveCalls, paidByUnit } from "./accounts";
import { loadSplitInput, mainCoOwners, RESERVE_LABEL } from "./calls";

/**
 * Charges page of a residence: its categories (with their key's building or units), the
 * budget of `year` (or last year's amounts to start from) and the other budget years.
 */
export async function getChargesSetup(ctx: TenantCtx, residenceId: string, year: number) {
  assertCan(ctx, "charge:read");
  if (!isUuid(residenceId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ residence, projectName: project.name })
      .from(residence)
      .innerJoin(project, eq(project.id, residence.projectId))
      .where(and(eq(residence.id, residenceId), isNull(residence.deletedAt)));
    if (!row) return null;

    const categories = await tx
      .select({
        id: chargeCategory.id,
        name: chargeCategory.name,
        nameAr: chargeCategory.nameAr,
        key: chargeCategory.key,
        weighting: chargeCategory.weighting,
        buildingId: chargeCategory.buildingId,
        buildingCode: building.code,
      })
      .from(chargeCategory)
      .leftJoin(building, eq(building.id, chargeCategory.buildingId))
      .where(and(eq(chargeCategory.residenceId, residenceId), isNull(chargeCategory.deletedAt)))
      .orderBy(asc(chargeCategory.position), asc(chargeCategory.name));
    const customUnits =
      categories.length === 0
        ? []
        : await tx
            .select({
              categoryId: chargeCategoryUnit.categoryId,
              unitId: chargeCategoryUnit.unitId,
            })
            .from(chargeCategoryUnit)
            .where(
              inArray(
                chargeCategoryUnit.categoryId,
                categories.map((c) => c.id),
              ),
            );

    const units = await tx
      .select({
        unitId: unit.id,
        code: unit.code,
        buildingId: unit.buildingId,
        share: residenceUnit.share,
      })
      .from(residenceUnit)
      .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
      .where(eq(residenceUnit.residenceId, residenceId))
      .orderBy(asc(unit.code));
    const buildings = await tx
      .select({ id: building.id, code: building.code, name: building.name })
      .from(building)
      .where(and(eq(building.projectId, row.residence.projectId), isNull(building.deletedAt)))
      .orderBy(asc(building.code));

    const budgets = await tx
      .select({
        id: budget.id,
        year: budget.year,
        status: budget.status,
        frequency: budget.frequency,
        reserveFundBp: budget.reserveFundBp,
        approvedAt: budget.approvedAt,
        notes: budget.notes,
      })
      .from(budget)
      .where(eq(budget.residenceId, residenceId))
      .orderBy(desc(budget.year));
    const current = budgets.find((b) => b.year === year) ?? null;
    // Amounts shown: the year's budget, else the latest approved one before it, to start from.
    const source = current ?? budgets.find((b) => b.year < year && b.status === "approved") ?? null;
    const lines = source
      ? await tx
          .select({ categoryId: budgetLine.categoryId, amount: budgetLine.amount })
          .from(budgetLine)
          .where(eq(budgetLine.budgetId, source.id))
      : [];

    return {
      residence: { ...row.residence, projectName: row.projectName },
      categories: categories.map((c) => ({
        ...c,
        unitIds: customUnits.filter((u) => u.categoryId === c.id).map((u) => u.unitId),
      })),
      units,
      buildings,
      budgets,
      budget: current,
      /** Year the amounts come from (null: nothing budgeted yet). */
      amountsFrom: source?.year ?? null,
      lines,
    };
  });
}

export type ChargesSetup = NonNullable<Awaited<ReturnType<typeof getChargesSetup>>>;
export type ChargeCategoryRow = ChargesSetup["categories"][number];

/**
 * Calls page of a residence: its issued (and cancelled) periods, newest first, and a preview
 * of every period still to issue from its approved budgets (calls, total, parts that cannot be
 * split), with the units that have no co-owner today.
 */
export async function getCallsSetup(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "charge:read");
  if (!isUuid(residenceId)) return null;
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ residence, projectName: project.name })
      .from(residence)
      .innerJoin(project, eq(project.id, residence.projectId))
      .where(and(eq(residence.id, residenceId), isNull(residence.deletedAt)));
    if (!row) return null;
    const periods = await tx
      .select({
        id: chargePeriod.id,
        year: chargePeriod.year,
        frequency: chargePeriod.frequency,
        periodIndex: chargePeriod.periodIndex,
        issuedOn: chargePeriod.issuedOn,
        dueOn: chargePeriod.dueOn,
        total: chargePeriod.total,
        reserve: chargePeriod.reserve,
        callCount: chargePeriod.callCount,
        status: chargePeriod.status,
        budgetId: chargePeriod.budgetId,
      })
      .from(chargePeriod)
      .where(eq(chargePeriod.residenceId, residenceId))
      .orderBy(
        desc(chargePeriod.year),
        desc(chargePeriod.periodIndex),
        desc(chargePeriod.issuedAt),
      );

    const approved = await tx
      .select({
        id: budget.id,
        year: budget.year,
        frequency: budget.frequency,
        reserveFundBp: budget.reserveFundBp,
      })
      .from(budget)
      .where(and(eq(budget.residenceId, residenceId), eq(budget.status, "approved")))
      .orderBy(asc(budget.year));
    const owners = await mainCoOwners(tx, residenceId, today);
    const toIssue = [];
    for (const b of approved) {
      if (!b.frequency || b.reserveFundBp === null) continue;
      const input = await loadSplitInput(tx, residenceId, b.id);
      for (let index = 1; index <= callsPerYear[b.frequency]; index += 1) {
        const issued = periods.some(
          (p) => p.budgetId === b.id && p.periodIndex === index && p.status === "issued",
        );
        if (issued) continue;
        const split = buildChargeCalls({
          ...input,
          frequency: b.frequency,
          periodIndex: index,
          reserveFundBp: b.reserveFundBp,
          reserveLabel: RESERVE_LABEL,
        });
        toIssue.push({
          budgetId: b.id,
          year: b.year,
          frequency: b.frequency,
          periodIndex: index,
          calls: split.calls.length,
          total: split.total,
          reserve: split.reserve,
          withoutCoOwner: split.calls.filter((c) => !owners.has(c.unitId)).length,
          problems: split.problems.map((p) => ({
            category:
              p.categoryId === null
                ? null
                : (input.categories.find((c) => c.id === p.categoryId)?.name ?? "—"),
            reason: p.reason,
          })),
        });
      }
    }
    return {
      residence: { ...row.residence, projectName: row.projectName },
      periods,
      toIssue,
    };
  });
}

export type CallsSetup = NonNullable<Awaited<ReturnType<typeof getCallsSetup>>>;
export type PeriodToIssue = CallsSetup["toIssue"][number];

/** One issued period with its calls (unit, addressee, amount, PDF), by unit code. */
export async function getChargePeriod(ctx: TenantCtx, periodId: string) {
  assertCan(ctx, "charge:read");
  if (!isUuid(periodId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        period: chargePeriod,
        residenceName: residence.name,
        cancelledByName: user.name,
      })
      .from(chargePeriod)
      .innerJoin(residence, eq(residence.id, chargePeriod.residenceId))
      .leftJoin(user, eq(user.id, chargePeriod.cancelledBy))
      .where(eq(chargePeriod.id, periodId));
    if (!row) return null;
    const calls = await tx
      .select({
        id: chargeCall.id,
        number: chargeCall.number,
        unitId: chargeCall.unitId,
        unitCode: unit.code,
        addresseeName: chargeCall.addresseeName,
        amount: chargeCall.amount,
        reserve: chargeCall.reserve,
        pdfFileId: chargeCall.pdfFileId,
      })
      .from(chargeCall)
      .innerJoin(unit, eq(unit.id, chargeCall.unitId))
      .where(eq(chargeCall.periodId, periodId))
      .orderBy(asc(unit.code));
    return {
      ...row.period,
      residenceName: row.residenceName,
      cancelledByName: row.cancelledByName,
      calls,
    };
  });
}

export type ChargePeriodDetail = NonNullable<Awaited<ReturnType<typeof getChargePeriod>>>;

/**
 * Charges accounts of a residence's units: called on live calls, paid, still due, overdue and
 * advance (derived, CLAUDE.md §7), with the main co-owner today and the reserve fund totals.
 */
export async function listUnitAccounts(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "charge:read");
  if (!isUuid(residenceId)) return null;
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ residence, projectName: project.name })
      .from(residence)
      .innerJoin(project, eq(project.id, residence.projectId))
      .where(and(eq(residence.id, residenceId), isNull(residence.deletedAt)));
    if (!row) return null;
    const units = await tx
      .select({ unitId: residenceUnit.unitId, code: unit.code })
      .from(residenceUnit)
      .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
      .where(eq(residenceUnit.residenceId, residenceId))
      .orderBy(asc(unit.code));
    const calls = await liveCalls(tx, residenceId);
    const paid = await paidByUnit(tx, residenceId);
    const owners = await mainCoOwners(tx, residenceId, today);
    const rows = units.map((u) => {
      const unitPaid = paid.get(u.unitId) ?? 0n;
      const statement = chargeStatement(
        calls.filter((c) => c.unitId === u.unitId),
        unitPaid,
        today,
      );
      const owner = owners.get(u.unitId);
      return {
        unitId: u.unitId,
        code: u.code,
        coOwner: owner ? `${owner.lastName} ${owner.firstName}` : null,
        called: statement.price,
        paid: unitPaid,
        remaining: statement.remaining,
        overdue: statement.overdue,
        credit: statement.credit,
        reserveCalled: statement.reserveCalled,
        reserveCollected: statement.reserveCollected,
      };
    });
    const total = (pick: (r: (typeof rows)[number]) => bigint) => sumCentimes(rows.map(pick));
    return {
      residence: { ...row.residence, projectName: row.projectName },
      rows,
      totals: {
        called: total((r) => r.called),
        paid: total((r) => r.paid),
        remaining: total((r) => r.remaining),
        overdue: total((r) => r.overdue),
        credit: total((r) => r.credit),
        reserveCalled: total((r) => r.reserveCalled),
        reserveCollected: total((r) => r.reserveCollected),
      },
    };
  });
}

export type UnitAccountsList = NonNullable<Awaited<ReturnType<typeof listUnitAccounts>>>;

/**
 * One unit's charges account: its live calls with what each still owes (derived), its payments
 * and receipts (cancelled ones included) and its current co-owners.
 */
export async function getUnitAccount(ctx: TenantCtx, residenceId: string, unitId: string) {
  assertCan(ctx, "charge:read");
  if (!isUuid(residenceId) || !isUuid(unitId)) return null;
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        residenceName: residence.name,
        shareBasis: residence.shareBasis,
        code: unit.code,
        typology: unit.typology,
        buildingName: building.name,
        share: residenceUnit.share,
      })
      .from(residenceUnit)
      .innerJoin(residence, eq(residence.id, residenceUnit.residenceId))
      .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
      .innerJoin(building, eq(building.id, unit.buildingId))
      .where(
        and(
          eq(residenceUnit.residenceId, residenceId),
          eq(residenceUnit.unitId, unitId),
          isNull(residence.deletedAt),
        ),
      );
    if (!row) return null;
    const calls = await liveCalls(tx, residenceId, [unitId]);
    const paid = (await paidByUnit(tx, residenceId, [unitId])).get(unitId) ?? 0n;
    const statement = chargeStatement(calls, paid, today);
    const payments = await tx
      .select({
        id: chargePayment.id,
        receiptNumber: chargePayment.receiptNumber,
        amount: chargePayment.amount,
        method: chargePayment.method,
        paidOn: chargePayment.paidOn,
        reference: chargePayment.reference,
        bank: chargePayment.bank,
        payerName: chargePayment.payerName,
        chequeClearedOn: chargePayment.chequeClearedOn,
        status: chargePayment.status,
        cancellationReason: chargePayment.cancellationReason,
        pdfFileId: chargePayment.pdfFileId,
        allocation: chargePayment.allocation,
      })
      .from(chargePayment)
      .where(and(eq(chargePayment.residenceId, residenceId), eq(chargePayment.unitId, unitId)))
      .orderBy(desc(chargePayment.paidOn), desc(chargePayment.createdAt));
    const owners = await mainCoOwners(tx, residenceId, today);
    const owner = owners.get(unitId);
    return {
      ...row,
      residenceId,
      unitId,
      coOwner: owner ? `${owner.lastName} ${owner.firstName}` : null,
      statement,
      payments,
    };
  });
}

export type UnitAccount = NonNullable<Awaited<ReturnType<typeof getUnitAccount>>>;
