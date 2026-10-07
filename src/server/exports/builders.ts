import "server-only";

import { and, asc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  buyer,
  building,
  chargePayment,
  constructionMilestone,
  installment,
  lead,
  lease,
  payment,
  project,
  receipt,
  rentPayment,
  reservation,
  residence,
  resident,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { sumCentimes } from "@/lib/money";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { ageingBuckets } from "@/lib/reports";
import { computeStatement } from "@/lib/statement";
import { getAccountingEntries } from "@/server/accounting/service";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { visibleBuyers } from "@/server/buyers/access";
import { searchCondition as buyerSearch } from "@/server/buyers/queries";
import { listUnitAccounts } from "@/server/charges/queries";
import { listConditions as leadConditions } from "@/server/crm/queries";
import { listLeases } from "@/server/rentals/queries";
import { visibleSales } from "@/server/sales/access";
import { buyerNames, paidTotals, searchCondition as saleSearch } from "@/server/sales/sale-queries";
import { listInvoices } from "@/server/suppliers/queries";
import { getReports } from "@/server/reports/queries";
import { getAccountLedger } from "@/server/treasury/queries";

import type { ExportKind, ExportParams } from "./schemas";
import { type ExportSheet, exportFileName, MAX_EXPORT_ROWS } from "./xlsx";

/** A translator from the message catalogs (root keys: `exports.…`, `payments.method.…`). */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

export type ExportResult = { file: string; sheets: ExportSheet[]; rows: number };

const NO_PENALTY = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };
const commercial = alias(user, "commercial");
const assignee = alias(user, "assignee");

const cap = <T>(rows: T[]): T[] => {
  if (rows.length > MAX_EXPORT_ROWS) throw new AppError("CONFLICT", "exports.errors.tooMany");
  return rows;
};
const yesNo = (t: Translate, value: boolean) => t(value ? "exports.yes" : "exports.no");

/** The first day of the month of `day` ("YYYY-MM-01"). */
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

/**
 * Journal des encaissements: every payment received over a period — sales (REC), charges (RCH),
 * rents and deposits (QIT) — with its state, and a summary by nature and method. Each source
 * needs its own reading right (sales: `sale:read_all`, charges: `charge:read`, rents:
 * `lease:read`).
 */
async function collections(
  ctx: TenantCtx,
  params: ExportParams<"collections">,
  t: Translate,
): Promise<ExportResult> {
  assertCan(ctx, "payment:read");
  const today = todayInAlgiers();
  const from = params.from ?? monthStart(today);
  const to = params.to ?? today;
  if (to < from) throw new AppError("VALIDATION", "exports.errors.period");
  type Line = {
    paidOn: string;
    number: string | null;
    nature: string;
    payer: string;
    object: string;
    method: string;
    reference: string | null;
    bank: string | null;
    amount: bigint;
    valid: boolean;
    clearedOn: string | null;
    reason: string | null;
    recordedBy: string;
  };
  const lines: Line[] = [];
  await withTenant(ctx, async (tx) => {
    if (can(ctx.roles, "sale:read_all")) {
      const rows = await tx
        .select({
          paidOn: payment.paidOn,
          number: receipt.number,
          legacyReceipt: payment.legacyReceipt,
          payer: payment.payerName,
          saleNumber: reservation.number,
          projectName: project.name,
          unitCode: unit.code,
          method: payment.method,
          reference: payment.reference,
          bank: payment.bank,
          amount: payment.amount,
          status: payment.status,
          clearedOn: payment.chequeClearedOn,
          reason: payment.cancellationReason,
          recordedBy: user.name,
        })
        .from(payment)
        .leftJoin(receipt, eq(receipt.paymentId, payment.id))
        .innerJoin(reservation, eq(reservation.id, payment.reservationId))
        .innerJoin(unit, eq(unit.id, reservation.unitId))
        .innerJoin(project, eq(project.id, reservation.projectId))
        .innerJoin(user, eq(user.id, payment.recordedBy))
        .where(and(gte(payment.paidOn, from), lte(payment.paidOn, to)));
      for (const r of rows) {
        lines.push({
          ...r,
          // An imported payment keeps the previous system's receipt number.
          number: r.number ?? r.legacyReceipt,
          nature: t("exports.nature.sale"),
          object: `${r.saleNumber} · ${r.projectName} · ${r.unitCode}`,
          method: t(`payments.method.${r.method}`),
          valid: r.status === "valid",
        });
      }
    }
    if (can(ctx.roles, "charge:read")) {
      const rows = await tx
        .select({
          paidOn: chargePayment.paidOn,
          number: chargePayment.receiptNumber,
          payer: chargePayment.payerName,
          residenceName: residence.name,
          unitCode: unit.code,
          method: chargePayment.method,
          reference: chargePayment.reference,
          bank: chargePayment.bank,
          amount: chargePayment.amount,
          status: chargePayment.status,
          clearedOn: chargePayment.chequeClearedOn,
          reason: chargePayment.cancellationReason,
          recordedBy: user.name,
        })
        .from(chargePayment)
        .innerJoin(residence, eq(residence.id, chargePayment.residenceId))
        .innerJoin(unit, eq(unit.id, chargePayment.unitId))
        .innerJoin(user, eq(user.id, chargePayment.recordedBy))
        .where(and(gte(chargePayment.paidOn, from), lte(chargePayment.paidOn, to)));
      for (const r of rows) {
        lines.push({
          ...r,
          nature: t("exports.nature.charges"),
          object: `${r.residenceName} · ${r.unitCode}`,
          method: t(`payments.method.${r.method}`),
          valid: r.status === "valid",
        });
      }
    }
    if (can(ctx.roles, "lease:read")) {
      const rows = await tx
        .select({
          paidOn: rentPayment.paidOn,
          number: rentPayment.receiptNumber,
          kind: rentPayment.kind,
          payer: rentPayment.payerName,
          leaseNumber: lease.number,
          unitCode: unit.code,
          method: rentPayment.method,
          reference: rentPayment.reference,
          bank: rentPayment.bank,
          amount: rentPayment.amount,
          status: rentPayment.status,
          clearedOn: rentPayment.chequeClearedOn,
          reason: rentPayment.cancellationReason,
          recordedBy: user.name,
        })
        .from(rentPayment)
        .innerJoin(lease, eq(lease.id, rentPayment.leaseId))
        .innerJoin(unit, eq(unit.id, lease.unitId))
        .innerJoin(user, eq(user.id, rentPayment.recordedBy))
        .where(and(gte(rentPayment.paidOn, from), lte(rentPayment.paidOn, to)));
      for (const r of rows) {
        lines.push({
          ...r,
          nature: t(r.kind === "deposit" ? "exports.nature.deposit" : "exports.nature.rent"),
          object: `${r.leaseNumber} · ${r.unitCode}`,
          method: t(`payments.method.${r.method}`),
          valid: r.status === "valid",
        });
      }
    }
  });
  cap(lines);
  lines.sort(
    (a, b) => a.paidOn.localeCompare(b.paidOn) || (a.number ?? "").localeCompare(b.number ?? ""),
  );

  // Totals of the valid payments by nature and method.
  const totals = new Map<
    string,
    { nature: string; method: string; count: number; amounts: bigint[] }
  >();
  for (const line of lines.filter((l) => l.valid)) {
    const key = `${line.nature}\u0000${line.method}`;
    const entry = totals.get(key) ?? {
      nature: line.nature,
      method: line.method,
      count: 0,
      amounts: [],
    };
    entry.count += 1;
    entry.amounts.push(line.amount);
    totals.set(key, entry);
  }
  const summary = [...totals.values()].sort(
    (a, b) => a.nature.localeCompare(b.nature) || a.method.localeCompare(b.method),
  );

  return {
    file: exportFileName("encaissements", `${from}_${to}`),
    rows: lines.length,
    sheets: [
      {
        name: t("exports.sheets.collections"),
        columns: [
          { header: t("exports.columns.date"), kind: "date" },
          { header: t("exports.columns.receipt"), width: 18 },
          { header: t("exports.columns.nature"), width: 16 },
          { header: t("exports.columns.payer"), width: 28 },
          { header: t("exports.columns.object"), width: 40 },
          { header: t("exports.columns.method"), width: 18 },
          { header: t("exports.columns.reference"), width: 18 },
          { header: t("exports.columns.bank"), width: 18 },
          { header: t("exports.columns.amount"), kind: "money" },
          { header: t("exports.columns.state"), width: 12 },
          { header: t("exports.columns.clearedOn"), kind: "date" },
          { header: t("exports.columns.cancellation"), width: 30 },
          { header: t("exports.columns.recordedBy"), width: 22 },
        ],
        rows: lines.map((l) => [
          l.paidOn,
          l.number,
          l.nature,
          l.payer,
          l.object,
          l.method,
          l.reference,
          l.bank,
          l.amount,
          t(l.valid ? "exports.valid" : "exports.cancelled"),
          l.clearedOn,
          l.reason,
          l.recordedBy,
        ]),
      },
      {
        name: t("exports.sheets.summary"),
        columns: [
          { header: t("exports.columns.nature"), width: 18 },
          { header: t("exports.columns.method"), width: 22 },
          { header: t("exports.columns.count"), kind: "integer" },
          { header: t("exports.columns.amount"), kind: "money" },
        ],
        rows: [
          ...summary.map((s) => [s.nature, s.method, s.count, sumCentimes(s.amounts)]),
          [
            t("exports.total"),
            null,
            summary.reduce((n, s) => n + s.count, 0),
            sumCentimes(summary.flatMap((s) => s.amounts)),
          ],
        ],
      },
    ],
  };
}

/** Sales (the list's filters), with their price, what is paid, what remains and what is late. */
async function sales(
  ctx: TenantCtx,
  params: ExportParams<"sales">,
  t: Translate,
): Promise<ExportResult> {
  assertCan(ctx, "sale:read");
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const rows = cap(
      await tx
        .select({
          id: reservation.id,
          number: reservation.number,
          status: reservation.status,
          reservedOn: reservation.reservedOn,
          listPrice: reservation.listPrice,
          price: reservation.price,
          saleNumber: reservation.saleNumber,
          saleSignedOn: reservation.saleSignedOn,
          notary: reservation.saleNotary,
          projectName: project.name,
          unitCode: unit.code,
          commercialName: commercial.name,
        })
        .from(reservation)
        .innerJoin(unit, eq(unit.id, reservation.unitId))
        .innerJoin(project, eq(project.id, reservation.projectId))
        .leftJoin(commercial, eq(commercial.id, reservation.commercialUserId))
        .where(
          and(
            visibleSales(ctx),
            params.status ? eq(reservation.status, params.status) : undefined,
            saleSearch(params.q),
          ),
        )
        .orderBy(asc(reservation.reservedOn), asc(reservation.number)),
    );
    const ids = rows.map((r) => r.id);
    const paid = await paidTotals(tx, ids);
    const names = await buyerNames(tx, ids);
    const lines =
      ids.length === 0
        ? []
        : await tx
            .select({
              reservationId: installment.reservationId,
              position: installment.position,
              label: installment.label,
              amount: installment.amount,
              dueOn: installment.dueOn,
            })
            .from(installment)
            .where(inArray(installment.reservationId, ids));
    return {
      file: exportFileName("ventes", today),
      rows: rows.length,
      sheets: [
        {
          name: t("exports.sheets.sales"),
          columns: [
            { header: t("exports.columns.reservation"), width: 18 },
            { header: t("exports.columns.reservedOn"), kind: "date" },
            { header: t("exports.columns.state"), width: 12 },
            { header: t("exports.columns.buyers"), width: 34 },
            { header: t("exports.columns.project"), width: 26 },
            { header: t("exports.columns.unit"), width: 12 },
            { header: t("exports.columns.listPrice"), kind: "money" },
            { header: t("exports.columns.price"), kind: "money" },
            { header: t("exports.columns.paid"), kind: "money" },
            { header: t("exports.columns.remaining"), kind: "money" },
            { header: t("exports.columns.overdue"), kind: "money" },
            { header: t("exports.columns.vsp"), width: 18 },
            { header: t("exports.columns.vspOn"), kind: "date" },
            { header: t("exports.columns.notary"), width: 24 },
            { header: t("exports.columns.commercial"), width: 22 },
          ],
          rows: rows.map((r) => {
            const statement = computeStatement(
              lines.filter((l) => l.reservationId === r.id),
              paid.get(r.id) ?? 0n,
              today,
              NO_PENALTY,
            );
            const live = r.status !== "withdrawn";
            return [
              r.number,
              r.reservedOn,
              t(`sales.status.${r.status}`),
              names.get(r.id) ?? "",
              r.projectName,
              r.unitCode,
              r.listPrice,
              r.price,
              paid.get(r.id) ?? 0n,
              live ? statement.remaining : null,
              live ? statement.overdue : null,
              r.saleNumber,
              r.saleSignedOn,
              r.notary,
              r.commercialName,
            ];
          }),
        },
      ],
    };
  });
}

/**
 * Échéancier: every installment of the live sales (reserved or sold), by due date — what is
 * paid on it, what remains and its state; the ones waiting for a milestone come last.
 */
async function installments(
  ctx: TenantCtx,
  _params: ExportParams<"installments">,
  t: Translate,
): Promise<ExportResult> {
  assertCan(ctx, "sale:read");
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const sales = await tx
      .select({
        id: reservation.id,
        number: reservation.number,
        projectName: project.name,
        unitCode: unit.code,
      })
      .from(reservation)
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .innerJoin(project, eq(project.id, reservation.projectId))
      .where(and(visibleSales(ctx), ne(reservation.status, "withdrawn")));
    const ids = sales.map((s) => s.id);
    const paid = await paidTotals(tx, ids);
    const names = await buyerNames(tx, ids);
    const all =
      ids.length === 0
        ? []
        : await tx
            .select({
              reservationId: installment.reservationId,
              position: installment.position,
              label: installment.label,
              amount: installment.amount,
              dueOn: installment.dueOn,
              milestoneName: constructionMilestone.name,
            })
            .from(installment)
            .leftJoin(constructionMilestone, eq(constructionMilestone.id, installment.milestoneId))
            .where(inArray(installment.reservationId, ids));
    const rows = sales.flatMap((sale) =>
      computeStatement(
        all.filter((i) => i.reservationId === sale.id),
        paid.get(sale.id) ?? 0n,
        today,
        NO_PENALTY,
      ).lines.map((line) => ({ sale, line })),
    );
    cap(rows);
    rows.sort(
      (a, b) =>
        (a.line.dueOn ?? "9999").localeCompare(b.line.dueOn ?? "9999") ||
        a.sale.number.localeCompare(b.sale.number) ||
        a.line.position - b.line.position,
    );
    return {
      file: exportFileName("echeancier", today),
      rows: rows.length,
      sheets: [
        {
          name: t("exports.sheets.installments"),
          columns: [
            { header: t("exports.columns.dueOn"), kind: "date" },
            { header: t("exports.columns.reservation"), width: 18 },
            { header: t("exports.columns.buyers"), width: 34 },
            { header: t("exports.columns.project"), width: 26 },
            { header: t("exports.columns.unit"), width: 12 },
            { header: t("exports.columns.position"), kind: "integer" },
            { header: t("exports.columns.label"), width: 30 },
            { header: t("exports.columns.milestone"), width: 26 },
            { header: t("exports.columns.amount"), kind: "money" },
            { header: t("exports.columns.paid"), kind: "money" },
            { header: t("exports.columns.remaining"), kind: "money" },
            { header: t("exports.columns.state"), width: 14 },
          ],
          rows: rows.map(({ sale, line }) => [
            line.dueOn,
            sale.number,
            names.get(sale.id) ?? "",
            sale.projectName,
            sale.unitCode,
            line.position,
            line.label,
            line.dueOn ? null : line.milestoneName,
            line.amount,
            line.paid,
            line.remaining,
            t(`sales.statement.state.${line.state}`),
          ]),
        },
      ],
    };
  });
}

/** Stock: the units (of a project, or all) with their areas, price and state. */
async function units(
  ctx: TenantCtx,
  params: ExportParams<"units">,
  t: Translate,
): Promise<ExportResult> {
  assertCan(ctx, "inventory:read");
  return withTenant(ctx, async (tx) => {
    const rows = cap(
      await tx
        .select({
          projectName: project.name,
          buildingCode: building.code,
          code: unit.code,
          floor: unit.floor,
          type: unit.type,
          typology: unit.typology,
          isDuplex: unit.isDuplex,
          livingArea: unit.livingArea,
          usableArea: unit.usableArea,
          share: unit.share,
          listPrice: unit.listPrice,
          status: unit.status,
        })
        .from(unit)
        .innerJoin(building, eq(building.id, unit.buildingId))
        .innerJoin(project, eq(project.id, unit.projectId))
        .where(
          and(
            isNull(unit.deletedAt),
            isNull(project.deletedAt),
            params.project ? eq(unit.projectId, params.project) : undefined,
          ),
        )
        .orderBy(asc(project.name), asc(building.code), asc(unit.floor), asc(unit.code)),
    );
    const area = (value: string | null) => (value === null ? null : Number(value));
    return {
      file: exportFileName("lots", todayInAlgiers()),
      rows: rows.length,
      sheets: [
        {
          name: t("exports.sheets.units"),
          columns: [
            { header: t("exports.columns.project"), width: 26 },
            { header: t("exports.columns.building"), width: 10 },
            { header: t("exports.columns.unit"), width: 12 },
            { header: t("exports.columns.floor"), kind: "integer" },
            { header: t("exports.columns.type"), width: 16 },
            { header: t("exports.columns.typology"), width: 10 },
            { header: t("exports.columns.duplex"), width: 8 },
            { header: t("exports.columns.livingArea"), kind: "area" },
            { header: t("exports.columns.usableArea"), kind: "area" },
            { header: t("exports.columns.share"), kind: "integer" },
            { header: t("exports.columns.listPrice"), kind: "money" },
            { header: t("exports.columns.state"), width: 12 },
          ],
          rows: rows.map((r) => [
            r.projectName,
            r.buildingCode,
            r.code,
            r.floor,
            t(`inventory.unitType.${r.type}`),
            r.typology,
            yesNo(t, r.isDuplex),
            area(r.livingArea),
            area(r.usableArea),
            r.share,
            r.listPrice,
            t(`inventory.unitStatus.${r.status}`),
          ]),
        },
      ],
    };
  });
}

/** Leads (the list's filters; a commercial gets their own). */
async function leads(
  ctx: TenantCtx,
  params: ExportParams<"leads">,
  t: Translate,
): Promise<ExportResult> {
  assertCan(ctx, "lead:read");
  return withTenant(ctx, async (tx) => {
    const rows = cap(
      await tx
        .select({
          fullName: lead.fullName,
          phone: lead.phone,
          phone2: lead.phone2,
          email: lead.email,
          city: lead.city,
          source: lead.source,
          stage: lead.stage,
          projectName: project.name,
          budget: lead.budget,
          financing: lead.financing,
          assigneeName: assignee.name,
          createdAt: lead.createdAt,
          lastActivityAt: lead.lastActivityAt,
        })
        .from(lead)
        .leftJoin(project, eq(project.id, lead.projectId))
        .leftJoin(assignee, eq(assignee.id, lead.assignedTo))
        .where(leadConditions(ctx, { ...params, page: undefined }))
        .orderBy(asc(lead.createdAt)),
    );
    return {
      file: exportFileName("prospects", todayInAlgiers()),
      rows: rows.length,
      sheets: [
        {
          name: t("exports.sheets.leads"),
          columns: [
            { header: t("exports.columns.name"), width: 28 },
            { header: t("exports.columns.phone"), width: 16 },
            { header: t("exports.columns.phone2"), width: 16 },
            { header: t("exports.columns.email"), width: 26 },
            { header: t("exports.columns.city"), width: 16 },
            { header: t("exports.columns.source"), width: 14 },
            { header: t("exports.columns.stage"), width: 16 },
            { header: t("exports.columns.project"), width: 24 },
            { header: t("exports.columns.budget"), kind: "money" },
            { header: t("exports.columns.financing"), width: 16 },
            { header: t("exports.columns.commercial"), width: 22 },
            { header: t("exports.columns.createdAt"), kind: "datetime" },
            { header: t("exports.columns.lastActivity"), kind: "datetime" },
          ],
          rows: rows.map((r) => [
            r.fullName,
            r.phone,
            r.phone2,
            r.email,
            r.city,
            t(`crm.source.${r.source}`),
            t(`crm.stage.${r.stage}`),
            r.projectName,
            r.budget,
            r.financing ? t(`crm.financing.${r.financing}`) : null,
            r.assigneeName,
            r.createdAt,
            r.lastActivityAt,
          ]),
        },
      ],
    };
  });
}

/** Buyer files (the list's search; a commercial gets the ones they follow). */
async function buyers(
  ctx: TenantCtx,
  params: ExportParams<"buyers">,
  t: Translate,
): Promise<ExportResult> {
  assertCan(ctx, "buyer:read");
  return withTenant(ctx, async (tx) => {
    const rows = cap(
      await tx
        .select({
          lastName: buyer.lastName,
          firstName: buyer.firstName,
          lastNameAr: buyer.lastNameAr,
          firstNameAr: buyer.firstNameAr,
          birthDate: buyer.birthDate,
          nin: buyer.nin,
          phone: buyer.phone,
          phone2: buyer.phone2,
          email: buyer.email,
          address: buyer.address,
          commune: buyer.commune,
          wilaya: buyer.wilaya,
          profession: buyer.profession,
          employer: buyer.employer,
          whatsappOptIn: buyer.whatsappOptIn,
        })
        .from(buyer)
        .where(and(isNull(buyer.deletedAt), visibleBuyers(ctx), buyerSearch(params.q)))
        .orderBy(asc(buyer.lastName), asc(buyer.firstName)),
    );
    return {
      file: exportFileName("acquereurs", todayInAlgiers()),
      rows: rows.length,
      sheets: [
        {
          name: t("exports.sheets.buyers"),
          columns: [
            { header: t("exports.columns.lastName"), width: 18 },
            { header: t("exports.columns.firstName"), width: 18 },
            { header: t("exports.columns.lastNameAr"), width: 18 },
            { header: t("exports.columns.firstNameAr"), width: 18 },
            { header: t("exports.columns.birthDate"), kind: "date" },
            { header: t("exports.columns.nin"), width: 22 },
            { header: t("exports.columns.phone"), width: 16 },
            { header: t("exports.columns.phone2"), width: 16 },
            { header: t("exports.columns.email"), width: 26 },
            { header: t("exports.columns.address"), width: 30 },
            { header: t("exports.columns.commune"), width: 16 },
            { header: t("exports.columns.wilaya"), width: 16 },
            { header: t("exports.columns.profession"), width: 18 },
            { header: t("exports.columns.employer"), width: 20 },
            { header: t("exports.columns.whatsapp"), width: 10 },
          ],
          rows: rows.map((r) => [
            r.lastName,
            r.firstName,
            r.lastNameAr,
            r.firstNameAr,
            r.birthDate,
            r.nin,
            r.phone,
            r.phone2,
            r.email,
            r.address,
            r.commune,
            r.wilaya,
            r.profession,
            r.employer,
            yesNo(t, r.whatsappOptIn),
          ]),
        },
      ],
    };
  });
}

/** A residence: each unit's charges account, and its co-owners and occupants. */
async function charges(
  ctx: TenantCtx,
  params: ExportParams<"charges">,
  t: Translate,
): Promise<ExportResult> {
  const accounts = await listUnitAccounts(ctx, params.residence);
  if (!accounts) throw new AppError("NOT_FOUND");
  const people = await withTenant(ctx, (tx) =>
    tx
      .select({
        unitCode: unit.code,
        kind: resident.kind,
        isMain: resident.isMain,
        lastName: resident.lastName,
        firstName: resident.firstName,
        phone: resident.phone,
        email: resident.email,
        sinceOn: resident.sinceOn,
        untilOn: resident.untilOn,
        whatsappOptIn: resident.whatsappOptIn,
      })
      .from(resident)
      .innerJoin(unit, eq(unit.id, resident.unitId))
      .where(and(eq(resident.residenceId, params.residence), isNull(resident.deletedAt)))
      .orderBy(asc(unit.code), asc(resident.kind), asc(resident.lastName)),
  );
  const { totals } = accounts;
  return {
    file: exportFileName("charges", todayInAlgiers()),
    rows: accounts.rows.length + people.length,
    sheets: [
      {
        name: t("exports.sheets.accounts"),
        columns: [
          { header: t("exports.columns.unit"), width: 12 },
          { header: t("exports.columns.coOwner"), width: 28 },
          { header: t("exports.columns.called"), kind: "money" },
          { header: t("exports.columns.paid"), kind: "money" },
          { header: t("exports.columns.remaining"), kind: "money" },
          { header: t("exports.columns.overdue"), kind: "money" },
          { header: t("exports.columns.credit"), kind: "money" },
          { header: t("exports.columns.reserveCollected"), kind: "money" },
        ],
        rows: [
          ...accounts.rows.map((r) => [
            r.code,
            r.coOwner ?? t("exports.unassigned"),
            r.called,
            r.paid,
            r.remaining,
            r.overdue,
            r.credit,
            r.reserveCollected,
          ]),
          [
            t("exports.total"),
            null,
            totals.called,
            totals.paid,
            totals.remaining,
            totals.overdue,
            totals.credit,
            totals.reserveCollected,
          ],
        ],
      },
      {
        name: t("exports.sheets.residents"),
        columns: [
          { header: t("exports.columns.unit"), width: 12 },
          { header: t("exports.columns.residentKind"), width: 16 },
          { header: t("exports.columns.main"), width: 10 },
          { header: t("exports.columns.lastName"), width: 18 },
          { header: t("exports.columns.firstName"), width: 18 },
          { header: t("exports.columns.phone"), width: 16 },
          { header: t("exports.columns.email"), width: 26 },
          { header: t("exports.columns.since"), kind: "date" },
          { header: t("exports.columns.until"), kind: "date" },
          { header: t("exports.columns.whatsapp"), width: 10 },
        ],
        rows: people.map((p) => [
          p.unitCode,
          t(`residences.residents.kind.${p.kind}`),
          yesNo(t, p.isMain),
          p.lastName,
          p.firstName,
          p.phone,
          p.email,
          p.sinceOn,
          p.untilOn,
          yesNo(t, p.whatsappOptIn),
        ]),
      },
    ],
  };
}

/** Leases with their terms, state and unpaid rent. */
async function leases(
  ctx: TenantCtx,
  params: ExportParams<"leases">,
  t: Translate,
): Promise<ExportResult> {
  const { items } = await listLeases(ctx, {
    status: params.status ?? "all",
    projectId: params.project,
  });
  cap(items);
  return {
    file: exportFileName("baux", todayInAlgiers()),
    rows: items.length,
    sheets: [
      {
        name: t("exports.sheets.leases"),
        columns: [
          { header: t("exports.columns.lease"), width: 18 },
          { header: t("exports.columns.project"), width: 24 },
          { header: t("exports.columns.unit"), width: 12 },
          { header: t("exports.columns.leaseKind"), width: 14 },
          { header: t("exports.columns.tenant"), width: 28 },
          { header: t("exports.columns.phone"), width: 16 },
          { header: t("exports.columns.start"), kind: "date" },
          { header: t("exports.columns.end"), kind: "date" },
          { header: t("exports.columns.rent"), kind: "money" },
          { header: t("exports.columns.monthlyCharges"), kind: "money" },
          { header: t("exports.columns.frequency"), width: 14 },
          { header: t("exports.columns.state"), width: 14 },
          { header: t("exports.columns.overdue"), kind: "money" },
        ],
        rows: items.map((l) => [
          l.number,
          l.projectName,
          l.unitCode,
          t(`rentals.kind.${l.kind}`),
          l.tenantName,
          l.tenantPhone,
          l.startOn,
          l.endedOn ?? l.endOn,
          l.monthlyRent,
          l.monthlyCharges,
          t(`rentals.frequency.${l.frequency}`),
          t(`rentals.state.${l.state}`),
          l.overdue,
        ]),
      },
    ],
  };
}

/** Supplier invoices (of a residence, a year), with their booking and payment. */
async function invoices(
  ctx: TenantCtx,
  params: ExportParams<"invoices">,
  t: Translate,
): Promise<ExportResult> {
  const rows = cap(await listInvoices(ctx, { residenceId: params.residence, year: params.year }));
  return {
    file: exportFileName(
      "factures-fournisseurs",
      params.year ? String(params.year) : todayInAlgiers(),
    ),
    rows: rows.length,
    sheets: [
      {
        name: t("exports.sheets.invoices"),
        columns: [
          { header: t("exports.columns.date"), kind: "date" },
          { header: t("exports.columns.supplier"), width: 26 },
          { header: t("exports.columns.residence"), width: 24 },
          { header: t("exports.columns.invoiceNumber"), width: 16 },
          { header: t("exports.columns.label"), width: 30 },
          { header: t("exports.columns.booking"), width: 22 },
          { header: t("exports.columns.amount"), kind: "money" },
          { header: t("exports.columns.dueOn"), kind: "date" },
          { header: t("exports.columns.paidOn"), kind: "date" },
          { header: t("exports.columns.method"), width: 16 },
          { header: t("exports.columns.reference"), width: 16 },
        ],
        rows: rows.map((i) => [
          i.invoiceOn,
          i.supplierName,
          i.residenceName,
          i.number,
          i.label,
          i.fromReserve ? t("exports.reserveFund") : i.categoryName,
          i.amount,
          i.dueOn,
          i.paidOn,
          i.paymentMethod ? t(`payments.method.${i.paymentMethod}`) : null,
          i.paymentReference,
        ]),
      },
    ],
  };
}

/** An account's ledger over a period: the balance before it, each line, the running balance. */
async function ledger(
  ctx: TenantCtx,
  params: ExportParams<"ledger">,
  t: Translate,
): Promise<ExportResult> {
  const found = await getAccountLedger(ctx, params.account, { from: params.from, to: params.to });
  if (!found) throw new AppError("NOT_FOUND");
  const lines = cap(found.lines);
  return {
    file: exportFileName(`tresorerie-${found.account.name}`, `${found.from}_${found.to}`),
    rows: lines.length,
    sheets: [
      {
        name: found.account.name,
        columns: [
          { header: t("exports.columns.date"), kind: "date" },
          { header: t("exports.columns.nature"), width: 18 },
          { header: t("exports.columns.label"), width: 40 },
          { header: t("exports.columns.method"), width: 16 },
          { header: t("exports.columns.reference"), width: 18 },
          { header: t("exports.columns.in"), kind: "money" },
          { header: t("exports.columns.out"), kind: "money" },
          { header: t("exports.columns.balance"), kind: "money" },
        ],
        rows: [
          [found.from, t("treasury.ledger.before"), null, null, null, null, null, found.before],
          ...lines.map((l) => [
            l.on,
            t(`treasury.source.${l.source}`),
            l.label,
            l.method ? t(`payments.method.${l.method}`) : null,
            l.reference,
            l.amountIn > 0n ? l.amountIn : null,
            l.amountOut > 0n ? l.amountOut : null,
            l.balance,
          ]),
        ],
      },
    ],
  };
}

/** Journal entries of the period (two lines per flow), for the chartered accountant. */
async function accounting(
  ctx: TenantCtx,
  params: ExportParams<"accounting">,
  t: Translate,
): Promise<ExportResult> {
  const found = await getAccountingEntries(ctx, params);
  const lines = cap(found.lines);
  return {
    file: exportFileName("ecritures", `${found.from}_${found.to}`),
    rows: lines.length,
    sheets: [
      {
        name: t("accounting.sheet"),
        columns: [
          { header: t("accounting.columns.journal"), width: 10 },
          { header: t("accounting.columns.date"), kind: "date" },
          { header: t("accounting.columns.piece"), width: 18 },
          { header: t("accounting.columns.account"), width: 12 },
          { header: t("accounting.columns.label"), width: 44 },
          { header: t("accounting.columns.debit"), kind: "money" },
          { header: t("accounting.columns.credit"), kind: "money" },
        ],
        rows: [
          ...lines.map((l) => [
            l.journal,
            l.on,
            l.piece,
            l.account,
            l.label,
            l.debit > 0n ? l.debit : null,
            l.credit > 0n ? l.credit : null,
          ]),
          [null, null, null, null, t("accounting.total"), found.debit, found.credit],
        ],
      },
    ],
  };
}

/** The management reports, one sheet per table. */
async function report(
  ctx: TenantCtx,
  params: ExportParams<"report">,
  t: Translate,
): Promise<ExportResult> {
  const r = await getReports(ctx, params);
  const typology = (value: string) =>
    /^F\d$/.test(value) ? value : t(`inventory.unitType.${value}`);
  const sheets: ExportSheet[] = [
    {
      name: t("reports.byMonth.title"),
      columns: [
        { header: t("reports.columns.month"), width: 12 },
        { header: t("reports.columns.reservations"), kind: "integer" },
        { header: t("reports.columns.reserved"), kind: "money" },
        { header: t("reports.columns.sales"), kind: "integer" },
        { header: t("reports.columns.sold"), kind: "money" },
        { header: t("reports.columns.collected"), kind: "money" },
      ],
      rows: r.byMonth.map((m) => [
        m.month,
        m.reservations,
        m.reserved,
        m.sales,
        m.sold,
        m.collected,
      ]),
    },
    {
      name: t("reports.byTypology.title"),
      columns: [
        { header: t("reports.columns.project"), width: 26 },
        { header: t("reports.columns.typology"), width: 14 },
        { header: t("reports.columns.count"), kind: "integer" },
        { header: t("reports.columns.value"), kind: "money" },
        { header: t("reports.columns.perSquareMeter"), kind: "money" },
      ],
      rows: r.byTypology.map((g) => [
        g.projectName,
        typology(g.typology),
        g.count,
        g.value,
        g.perSquareMeter,
      ]),
    },
    {
      name: t("reports.commercials.title"),
      columns: [
        { header: t("reports.columns.commercial"), width: 24 },
        { header: t("reports.columns.leads"), kind: "integer" },
        { header: t("reports.columns.reservations"), kind: "integer" },
        { header: t("reports.columns.sales"), kind: "integer" },
        { header: t("reports.columns.reserved"), kind: "money" },
        { header: t("reports.columns.collected"), kind: "money" },
      ],
      rows: r.commercials.map((c) => [
        c.name,
        c.leads,
        c.reservations,
        c.sales,
        c.reserved,
        c.collected,
      ]),
    },
    {
      name: t("reports.ageing.title"),
      columns: [
        { header: t("reports.columns.age"), width: 30 },
        { header: t("reports.columns.value"), kind: "money" },
      ],
      rows: ageingBuckets.map((b) => [t(`reports.ageing.${b}`), r.ageing[b]]),
    },
    {
      name: t("reports.forecast.title"),
      columns: [
        { header: t("reports.columns.month"), width: 12 },
        { header: t("reports.columns.value"), kind: "money" },
      ],
      rows: [
        ...r.forecast.map((m) => [m.month, m.expected]),
        [t("reports.forecast.later"), r.forecastLater],
      ],
    },
    {
      name: t("reports.sources.sheet"),
      columns: [
        { header: t("reports.sources.source"), width: 18 },
        { header: t("reports.columns.leads"), kind: "integer" },
        { header: t("reports.columns.reservations"), kind: "integer" },
        { header: t("reports.columns.reserved"), kind: "money" },
        { header: t("reports.sources.spend"), kind: "money" },
        { header: t("reports.sources.costPerLead"), kind: "money" },
        { header: t("reports.sources.costPerSale"), kind: "money" },
      ],
      rows: r.sources.map((s) => [
        t(`crm.source.${s.source}`),
        s.leads,
        s.reservations,
        s.revenue,
        s.spend,
        s.costPerLead,
        s.costPerSale,
      ]),
    },
    {
      name: t("reports.stock.title"),
      columns: [
        { header: t("reports.columns.project"), width: 26 },
        { header: t("reports.columns.typology"), width: 14 },
        { header: t("reports.stock.available"), kind: "integer" },
        { header: t("reports.stock.optioned"), kind: "integer" },
        { header: t("reports.stock.reserved"), kind: "integer" },
        { header: t("reports.stock.sold"), kind: "integer" },
        { header: t("reports.stock.value"), kind: "money" },
      ],
      rows: r.stock.map((s) => [
        s.projectName,
        typology(s.typology),
        s.available,
        s.optioned,
        s.reserved,
        s.sold,
        s.value,
      ]),
    },
  ];
  return {
    file: exportFileName("rapports", `${r.from}_${r.to}`),
    rows: sheets.reduce((n, s) => n + s.rows.length, 0),
    sheets,
  };
}

type Builder<K extends ExportKind> = (
  ctx: TenantCtx,
  params: ExportParams<K>,
  t: Translate,
) => Promise<ExportResult>;

export const builders: { [K in ExportKind]: Builder<K> } = {
  collections,
  sales,
  installments,
  units,
  leads,
  buyers,
  charges,
  leases,
  invoices,
  ledger,
  report,
  accounting,
};
