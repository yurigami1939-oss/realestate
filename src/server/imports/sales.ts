import "server-only";

import { eq, isNull } from "drizzle-orm";

import {
  buyer,
  constructionMilestone,
  installment,
  member,
  payment,
  project,
  reservation,
  reservationBuyer,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { type CalendarDate, fromAlgiersDateTime, todayInAlgiers } from "@/lib/dates";
import { allocate, type Centimes, parseDZD, sumCentimes } from "@/lib/money";
import { milestoneDueOn } from "@/lib/payment-plans";
import { normalizePhone } from "@/lib/phone";
import { counterPaymentMethods } from "@/lib/sales";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { transitionUnit } from "@/server/inventory/transition-unit";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";
import { loadSalesSettings } from "@/server/organizations/settings";

import { IMPORT_REASON, type ImportPlan, issuesOf, type TemplateSheet } from "./plan";
import {
  choice,
  date,
  type ImportIssue,
  money,
  normalize,
  phone,
  sheetRows,
  text,
  type Workbook,
} from "./sheets";

const help = (fr: string, ar: string) => ({ fr, ar });
const REF = { key: "ref", fr: "Réf. vente", ar: "مرجع البيع", required: true };

export const salesSheets: {
  sales: TemplateSheet;
  installments: TemplateSheet;
  payments: TemplateSheet;
} = {
  sales: {
    name: { fr: "Ventes", ar: "المبيعات" },
    columns: [
      {
        ...REF,
        help: help(
          "Votre référence de la vente : relie les trois feuilles.",
          "مرجعكم للبيع: يربط الأوراق الثلاث.",
        ),
      },
      {
        key: "project",
        fr: "Code projet",
        ar: "رمز المشروع",
        required: true,
        help: help("Ex. OLIV.", "مثال OLIV."),
      },
      {
        key: "unit",
        fr: "Code lot",
        ar: "رمز الوحدة",
        required: true,
        help: help("Lot disponible du projet.", "وحدة متاحة في المشروع."),
      },
      {
        key: "buyer1",
        fr: "Acquéreur",
        ar: "المشتري",
        required: true,
        help: help(
          "NIN ou téléphone d'un acquéreur déjà importé.",
          "رقم التعريف الوطني أو هاتف مشترٍ مستورد مسبقاً.",
        ),
      },
      { key: "buyer2", fr: "Acquéreur 2", ar: "المشتري 2", help: help("Facultatif.", "اختياري.") },
      { key: "buyer3", fr: "Acquéreur 3", ar: "المشتري 3", help: help("Facultatif.", "اختياري.") },
      {
        key: "reservedOn",
        fr: "Date de réservation",
        ar: "تاريخ الحجز",
        required: true,
        help: help("jj/mm/aaaa.", "يوم/شهر/سنة."),
      },
      {
        key: "price",
        fr: "Prix de vente (DA)",
        ar: "سعر البيع (دج)",
        required: true,
        help: help("Prix net convenu.", "السعر الصافي المتفق عليه."),
      },
      {
        key: "listPrice",
        fr: "Prix catalogue (DA)",
        ar: "سعر القائمة (دج)",
        help: help("Si une remise a été consentie.", "إذا مُنح تخفيض."),
      },
      {
        key: "notary",
        fr: "Notaire (réservation)",
        ar: "الموثق (الحجز)",
        help: help("Libre.", "حر."),
      },
      {
        key: "contractRef",
        fr: "Réf. contrat de réservation",
        ar: "مرجع عقد الحجز",
        help: help("Libre.", "حر."),
      },
      {
        key: "saleOn",
        fr: "Date VSP",
        ar: "تاريخ عقد البيع",
        help: help(
          "Si la VSP est signée : la vente passe « vendue ».",
          "إذا وُقّع عقد البيع على التصاميم: يصبح البيع «مباعاً».",
        ),
      },
      {
        key: "saleNotary",
        fr: "Notaire (VSP)",
        ar: "الموثق (عقد البيع)",
        help: help("Libre.", "حر."),
      },
      { key: "saleRef", fr: "Réf. VSP", ar: "مرجع عقد البيع", help: help("Libre.", "حر.") },
      {
        key: "deliveryDueOn",
        fr: "Livraison contractuelle",
        ar: "التسليم التعاقدي",
        help: help(
          "Date de livraison promise au contrat ; vide = la livraison prévue du projet.",
          "تاريخ التسليم المنصوص عليه في العقد؛ فارغ = التسليم المتوقع للمشروع.",
        ),
      },
      {
        key: "commercial",
        fr: "Commercial (e-mail)",
        ar: "المكلّف بالمبيعات (البريد)",
        help: help("E-mail d'un membre.", "بريد أحد الأعضاء."),
      },
      { key: "notes", fr: "Remarques", ar: "ملاحظات", help: help("Libre.", "حر.") },
    ],
    example: {
      ref: "V-2024-017",
      project: "OLIV",
      unit: "A-03-02",
      buyer1: "0661 50 12 34",
      reservedOn: "15/03/2024",
      price: 13010000,
    },
  },
  installments: {
    name: { fr: "Échéancier", ar: "جدول الأقساط" },
    columns: [
      { ...REF, help: help("Réf. de la vente.", "مرجع البيع.") },
      {
        key: "position",
        fr: "N°",
        ar: "الرقم",
        required: true,
        help: help("1, 2, 3…", "1، 2، 3…"),
      },
      {
        key: "label",
        fr: "Libellé",
        ar: "البيان",
        required: true,
        help: help("Ex. Apport à la signature.", "مثال: الدفعة الأولى عند التوقيع."),
      },
      {
        key: "amount",
        fr: "Montant (DA)",
        ar: "المبلغ (دج)",
        required: true,
        help: help("Total = prix de vente.", "المجموع = سعر البيع."),
      },
      {
        key: "dueOn",
        fr: "Échéance",
        ar: "تاريخ الاستحقاق",
        help: help(
          "jj/mm/aaaa, ou vide si l'échéance attend une étape.",
          "يوم/شهر/سنة، أو فارغ إذا كان القسط ينتظر مرحلة.",
        ),
      },
      {
        key: "milestone",
        fr: "Étape",
        ar: "المرحلة",
        help: help("Nom d'une étape des travaux du projet.", "اسم مرحلة من مراحل أشغال المشروع."),
      },
    ],
    example: {
      ref: "V-2024-017",
      position: 1,
      label: "Apport à la signature",
      amount: 2602000,
      dueOn: "15/03/2024",
    },
  },
  payments: {
    name: { fr: "Paiements", ar: "المدفوعات" },
    columns: [
      { ...REF, help: help("Réf. de la vente.", "مرجع البيع.") },
      {
        key: "paidOn",
        fr: "Date",
        ar: "التاريخ",
        required: true,
        help: help("jj/mm/aaaa.", "يوم/شهر/سنة."),
      },
      {
        key: "amount",
        fr: "Montant (DA)",
        ar: "المبلغ (دج)",
        required: true,
        help: help("Total ≤ prix de vente.", "المجموع ≤ سعر البيع."),
      },
      {
        key: "method",
        fr: "Mode",
        ar: "طريقة الدفع",
        required: true,
        help: help(
          "Espèces, chèque, virement, CCP ou crédit bancaire.",
          "نقداً، صك، تحويل، الحساب البريدي الجاري أو قرض بنكي.",
        ),
      },
      {
        key: "reference",
        fr: "Référence",
        ar: "المرجع",
        help: help("N° de chèque, de virement…", "رقم الصك أو التحويل…"),
      },
      { key: "bank", fr: "Banque", ar: "البنك", help: help("Libre.", "حر.") },
      {
        key: "legacyReceipt",
        fr: "N° reçu d'origine",
        ar: "رقم الوصل الأصلي",
        help: help("Le reçu remis à l'époque.", "الوصل المسلَّم آنذاك."),
      },
      {
        key: "payer",
        fr: "Versé par",
        ar: "الدافع",
        help: help("Par défaut : le premier acquéreur.", "افتراضياً: المشتري الأول."),
      },
    ],
    example: {
      ref: "V-2024-017",
      paidOn: "15/03/2024",
      amount: 2602000,
      method: "Virement",
      legacyReceipt: "R-2024-0153",
    },
  },
};

const methodSynonyms = {
  especes: "cash",
  espece: "cash",
  liquide: "cash",
  cheque: "cheque",
  virement: "bank_transfer",
  "virement bancaire": "bank_transfer",
  versement: "bank_transfer",
  ccp: "ccp",
  "versement ccp": "ccp",
  credit: "bank_loan",
  "credit bancaire": "bank_loan",
  pret: "bank_loan",
} as const satisfies Record<string, (typeof counterPaymentMethods)[number]>;

type Line = {
  position: number;
  label: string;
  amount: Centimes;
  dueOn: CalendarDate | null;
  milestoneId: string | null;
  milestoneValidatedOn: CalendarDate | null;
};
type Paid = {
  paidOn: CalendarDate;
  amount: Centimes;
  method: (typeof counterPaymentMethods)[number];
  reference: string | null;
  bank: string | null;
  legacyReceipt: string | null;
  payer: string | null;
};
type Sale = {
  ref: string;
  row: number;
  projectId: string;
  unitId: string;
  unitCode: string;
  buyerIds: string[];
  mainBuyer: string;
  reservedOn: CalendarDate;
  price: Centimes;
  listPrice: Centimes;
  notary: string | null;
  contractRef: string | null;
  saleOn: CalendarDate | null;
  saleNotary: string | null;
  saleRef: string | null;
  deliveryDueOn: CalendarDate | null;
  commercialUserId: string | null;
  notes: string | null;
  lines: Line[];
  payments: Paid[];
};

const amountOf = (value: Parameters<typeof money>[0]): Centimes | null => {
  const parsed = parseDZD(money(value));
  return parsed !== null && parsed > 0n ? parsed : null;
};
const optional = (value: string) => (value === "" ? null : value);
/** Whole months from a day to another (for the installment's trigger, informative). */
const monthsBetween = (from: string, to: string) =>
  Math.max(
    0,
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
      Number(to.slice(5, 7)) -
      Number(from.slice(5, 7)),
  );
const noon = (day: CalendarDate) => fromAlgiersDateTime(`${day}T12:00`) ?? new Date();

/**
 * Sales in progress (CLAUDE.md §7 Imports): each sale of an available unit, its buyers (by NIN
 * or phone among the buyer files), its schedule as it was signed (dated lines, or lines waiting
 * for a milestone of the project) and the payments already received — recorded as imported
 * payments with the previous system's receipt number (no new REC- receipt). The unit becomes
 * reserved, or sold when the VSP date is given (VSP- number); no commission is computed.
 */
export async function prepareSales(ctx: TenantCtx, workbook: Workbook): Promise<ImportPlan> {
  assertCan(ctx, "sale:create");
  assertCan(ctx, "sale:sign");
  assertCan(ctx, "payment:create");
  assertCan(ctx, "buyer:read_all");
  const issues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const onSales = issuesOf(salesSheets.sales, issues);
  const onLines = issuesOf(salesSheets.installments, issues);
  const onPayments = issuesOf(salesSheets.payments, issues);
  const saleRows = sheetRows(workbook, salesSheets.sales.name, salesSheets.sales.columns, issues);
  const lineRows = sheetRows(
    workbook,
    salesSheets.installments.name,
    salesSheets.installments.columns,
    issues,
  );
  const paymentRows = sheetRows(
    workbook,
    salesSheets.payments.name,
    salesSheets.payments.columns,
    issues,
  );
  const today = todayInAlgiers();

  const data = await withTenant(ctx, async (tx) => ({
    projects: await tx
      .select({ id: project.id, code: project.code, plannedDeliveryOn: project.plannedDeliveryOn })
      .from(project)
      .where(isNull(project.deletedAt)),
    units: await tx
      .select({ id: unit.id, code: unit.code, projectId: unit.projectId, status: unit.status })
      .from(unit)
      .where(isNull(unit.deletedAt)),
    buyers: await tx
      .select({
        id: buyer.id,
        nin: buyer.nin,
        phone: buyer.phone,
        lastName: buyer.lastName,
        firstName: buyer.firstName,
      })
      .from(buyer)
      .where(isNull(buyer.deletedAt)),
    members: await tx
      .select({ userId: member.userId, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, ctx.orgId)),
    milestones: await tx
      .select({
        id: constructionMilestone.id,
        projectId: constructionMilestone.projectId,
        name: constructionMilestone.name,
        validatedOn: constructionMilestone.validatedOn,
      })
      .from(constructionMilestone)
      .where(isNull(constructionMilestone.deletedAt)),
    delayDays: (await loadSalesSettings(tx, ctx.orgId)).paymentCallDelayDays,
  }));

  const findBuyer = (value: Parameters<typeof phone>[0]) => {
    const raw = phone(value);
    if (raw === "") return { ids: [] as string[], raw };
    if (/^\d{18}$/.test(raw))
      return { ids: data.buyers.filter((b) => b.nin === raw).map((b) => b.id), raw };
    const e164 = normalizePhone(raw);
    return { ids: e164 ? data.buyers.filter((b) => b.phone === e164).map((b) => b.id) : [], raw };
  };

  const sales = new Map<string, Sale>();
  const usedUnits = new Set<string>();
  for (const { row, cells } of saleRows ?? []) {
    const ref = text(cells.ref ?? null);
    if (ref === "") {
      onSales.at(row, "ref", "validation.required");
      continue;
    }
    if (sales.has(normalize(ref))) {
      onSales.at(row, "ref", "imports.errors.duplicateInFile", { value: ref });
      continue;
    }
    const projectCode = text(cells.project ?? null);
    const home = data.projects.find((p) => normalize(p.code) === normalize(projectCode));
    if (!home) {
      onSales.at(row, "project", "imports.errors.projectNotFound", { code: projectCode });
      continue;
    }
    const unitCode = text(cells.unit ?? null);
    const target = data.units.find(
      (u) => u.projectId === home.id && normalize(u.code) === normalize(unitCode),
    );
    if (!target) {
      onSales.at(row, "unit", "imports.errors.unitNotFound", { code: unitCode });
      continue;
    }
    if (target.status !== "available" || usedUnits.has(target.id)) {
      onSales.at(row, "unit", "imports.errors.unitNotAvailable", { code: target.code });
      continue;
    }
    const buyerIds: string[] = [];
    let buyersOk = true;
    for (const key of ["buyer1", "buyer2", "buyer3"] as const) {
      const { ids, raw } = findBuyer(cells[key] ?? null);
      if (raw === "") {
        if (key === "buyer1") {
          onSales.at(row, key, "validation.required");
          buyersOk = false;
        }
        continue;
      }
      if (ids.length !== 1) {
        onSales.at(
          row,
          key,
          ids.length === 0 ? "imports.errors.buyerNotFound" : "imports.errors.buyerAmbiguous",
          { value: raw },
        );
        buyersOk = false;
        continue;
      }
      const [id] = ids;
      if (id && !buyerIds.includes(id)) buyerIds.push(id);
    }
    if (!buyersOk) continue;
    const reservedOn = date(cells.reservedOn ?? null);
    if (!reservedOn || reservedOn > today) {
      onSales.at(
        row,
        "reservedOn",
        reservedOn === "" ? "validation.required" : "imports.errors.date",
      );
      continue;
    }
    const price = amountOf(cells.price ?? null);
    if (price === null) {
      onSales.at(row, "price", "validation.amount");
      continue;
    }
    const listPrice =
      text(cells.listPrice ?? null) === "" ? price : amountOf(cells.listPrice ?? null);
    if (listPrice === null || listPrice < price) {
      onSales.at(row, "listPrice", "imports.errors.listPrice");
      continue;
    }
    const saleOn = date(cells.saleOn ?? null);
    if (saleOn === null || (saleOn !== "" && (saleOn < reservedOn || saleOn > today))) {
      onSales.at(row, "saleOn", "imports.errors.saleDate");
      continue;
    }
    const deliveryDueOn = date(cells.deliveryDueOn ?? null);
    if (deliveryDueOn === null) {
      onSales.at(row, "deliveryDueOn", "imports.errors.date");
      continue;
    }
    const commercialEmail = text(cells.commercial ?? null).toLowerCase();
    const commercial =
      commercialEmail === ""
        ? null
        : data.members.find((m) => m.email.toLowerCase() === commercialEmail);
    if (commercial === undefined) {
      onSales.at(row, "commercial", "imports.errors.memberNotFound", { value: commercialEmail });
      continue;
    }
    const main = data.buyers.find((b) => b.id === buyerIds[0]);
    usedUnits.add(target.id);
    sales.set(normalize(ref), {
      ref,
      row,
      projectId: home.id,
      unitId: target.id,
      unitCode: target.code,
      buyerIds,
      mainBuyer: main ? `${main.lastName} ${main.firstName}` : "",
      reservedOn,
      price,
      listPrice,
      notary: optional(text(cells.notary ?? null)),
      contractRef: optional(text(cells.contractRef ?? null)),
      saleOn: saleOn === "" ? null : saleOn,
      saleNotary: optional(text(cells.saleNotary ?? null)),
      saleRef: optional(text(cells.saleRef ?? null)),
      deliveryDueOn: deliveryDueOn === "" ? home.plannedDeliveryOn : deliveryDueOn,
      commercialUserId: commercial?.userId ?? null,
      notes: optional(text(cells.notes ?? null)),
      lines: [],
      payments: [],
    });
  }

  for (const { row, cells } of lineRows ?? []) {
    const ref = text(cells.ref ?? null);
    const sale = sales.get(normalize(ref));
    if (!sale) {
      onLines.at(row, "ref", "imports.errors.saleNotFound", { value: ref });
      continue;
    }
    const position = Number(text(cells.position ?? null));
    if (
      !Number.isInteger(position) ||
      position < 1 ||
      sale.lines.some((l) => l.position === position)
    ) {
      onLines.at(row, "position", "imports.errors.position");
      continue;
    }
    const label = text(cells.label ?? null);
    if (label === "") {
      onLines.at(row, "label", "validation.required");
      continue;
    }
    const amount = amountOf(cells.amount ?? null);
    if (amount === null) {
      onLines.at(row, "amount", "validation.amount");
      continue;
    }
    const dueOn = date(cells.dueOn ?? null);
    if (dueOn === null) {
      onLines.at(row, "dueOn", "imports.errors.date");
      continue;
    }
    const milestoneName = text(cells.milestone ?? null);
    const milestone =
      milestoneName === ""
        ? null
        : data.milestones.find(
            (m) => m.projectId === sale.projectId && normalize(m.name) === normalize(milestoneName),
          );
    if (milestone === undefined) {
      onLines.at(row, "milestone", "imports.errors.milestoneNotFound", { value: milestoneName });
      continue;
    }
    if (dueOn === "" && !milestone) {
      onLines.at(row, "dueOn", "imports.errors.dueOrMilestone");
      continue;
    }
    sale.lines.push({
      position,
      label,
      amount,
      dueOn: dueOn === "" ? null : dueOn,
      milestoneId: milestone?.id ?? null,
      milestoneValidatedOn: milestone?.validatedOn ?? null,
    });
  }

  for (const { row, cells } of paymentRows ?? []) {
    const ref = text(cells.ref ?? null);
    const sale = sales.get(normalize(ref));
    if (!sale) {
      onPayments.at(row, "ref", "imports.errors.saleNotFound", { value: ref });
      continue;
    }
    const paidOn = date(cells.paidOn ?? null);
    if (!paidOn || paidOn > today) {
      onPayments.at(row, "paidOn", paidOn === "" ? "validation.required" : "imports.errors.date");
      continue;
    }
    const amount = amountOf(cells.amount ?? null);
    if (amount === null) {
      onPayments.at(row, "amount", "validation.amount");
      continue;
    }
    const method = choice(
      cells.method ?? null,
      counterPaymentMethods,
      "payments.method",
      methodSynonyms,
    );
    if (method === null) {
      onPayments.at(row, "method", "imports.errors.choice", { value: text(cells.method ?? null) });
      continue;
    }
    sale.payments.push({
      paidOn,
      amount,
      method,
      reference: optional(text(cells.reference ?? null)),
      bank: optional(text(cells.bank ?? null)),
      legacyReceipt: optional(text(cells.legacyReceipt ?? null)),
      payer: optional(text(cells.payer ?? null)),
    });
  }

  for (const sale of sales.values()) {
    const scheduled = sumCentimes(sale.lines.map((l) => l.amount));
    if (sale.lines.length === 0) {
      onSales.at(sale.row, "ref", "imports.errors.noSchedule", { value: sale.ref });
    } else if (scheduled !== sale.price) {
      onSales.at(sale.row, "price", "imports.errors.scheduleTotal", { value: sale.ref });
    }
    if (sumCentimes(sale.payments.map((p) => p.amount)) > sale.price) {
      onSales.at(sale.row, "price", "imports.errors.paidAbovePrice", { value: sale.ref });
    }
  }

  const ready = [...sales.values()].sort((a, b) => a.reservedOn.localeCompare(b.reservedOn));
  return {
    counts: {
      sales: ready.length,
      installments: ready.reduce((n, s) => n + s.lines.length, 0),
      payments: ready.reduce((n, s) => n + s.payments.length, 0),
    },
    issues,
    warnings,
    apply: async (tx) => {
      for (const sale of ready) {
        const { number } = await nextDocumentNumber(tx, ctx, "reservation", noon(sale.reservedOn));
        const [row] = await tx
          .insert(reservation)
          .values({
            organizationId: ctx.orgId,
            number,
            unitId: sale.unitId,
            projectId: sale.projectId,
            commercialUserId: sale.commercialUserId,
            listPrice: sale.listPrice,
            discount: sale.listPrice - sale.price,
            price: sale.price,
            reservedOn: sale.reservedOn,
            reservationNotary: sale.notary,
            reservationReference: sale.contractRef,
            deliveryDueOn: sale.deliveryDueOn,
            notes: [`${IMPORT_REASON} : ${sale.ref}`, sale.notes].filter(Boolean).join(" · "),
            createdBy: ctx.userId,
          })
          .returning({ id: reservation.id });
        if (!row) throw new Error("importSales: no row returned");
        await tx.insert(reservationBuyer).values(
          sale.buyerIds.map((buyerId, index) => ({
            organizationId: ctx.orgId,
            reservationId: row.id,
            buyerId,
            position: index + 1,
          })),
        );
        const lines = [...sale.lines].sort((a, b) => a.position - b.position);
        const shares = allocate(
          10_000n,
          lines.map((l) => l.amount),
        );
        await tx.insert(installment).values(
          lines.map((line, index) => ({
            organizationId: ctx.orgId,
            reservationId: row.id,
            position: index + 1,
            label: line.label,
            shareBp: Number(shares[index] ?? 0n),
            amount: line.amount,
            trigger: line.milestoneId
              ? ("milestone" as const)
              : line.dueOn === sale.reservedOn
                ? ("signing" as const)
                : ("months_after_signing" as const),
            months:
              !line.milestoneId && line.dueOn ? monthsBetween(sale.reservedOn, line.dueOn) : null,
            milestoneId: line.milestoneId,
            dueOn:
              line.dueOn ??
              (line.milestoneValidatedOn
                ? milestoneDueOn(line.milestoneValidatedOn, data.delayDays, sale.reservedOn)
                : null),
          })),
        );
        await transitionUnit(tx, ctx, sale.unitId, "reserved", {
          reason: IMPORT_REASON,
          refType: "reservation",
          refId: row.id,
        });
        let saleNumber: string | null = null;
        if (sale.saleOn) {
          ({ number: saleNumber } = await nextDocumentNumber(
            tx,
            ctx,
            "sale_contract",
            noon(sale.saleOn),
          ));
          await tx
            .update(reservation)
            .set({
              status: "sold",
              saleNumber,
              saleSignedOn: sale.saleOn,
              saleNotary: sale.saleNotary,
              saleReference: sale.saleRef,
            })
            .where(eq(reservation.id, row.id));
          await transitionUnit(tx, ctx, sale.unitId, "sold", {
            reason: IMPORT_REASON,
            refType: "reservation",
            refId: row.id,
          });
        }
        if (sale.payments.length > 0) {
          await tx.insert(payment).values(
            sale.payments.map((p) => ({
              organizationId: ctx.orgId,
              reservationId: row.id,
              amount: p.amount,
              method: p.method,
              paidOn: p.paidOn,
              reference: p.reference,
              bank: p.bank,
              payerName: p.payer ?? sale.mainBuyer,
              imported: true,
              legacyReceipt: p.legacyReceipt,
              recordedBy: ctx.userId,
            })),
          );
        }
        await recordAudit(tx, ctx, {
          actorUserId: ctx.userId,
          action: "reservation.import",
          entityType: "reservation",
          entityId: row.id,
          after: {
            number,
            legacyRef: sale.ref,
            unit: sale.unitCode,
            buyers: sale.buyerIds,
            price: sale.price,
            installments: lines.length,
            payments: sale.payments.length,
            paid: sumCentimes(sale.payments.map((p) => p.amount)),
            saleNumber,
          },
        });
        await enqueueInTx(
          tx,
          "pdf.document",
          { organizationId: ctx.orgId, kind: "reservation_sheet", id: row.id },
          { singletonKey: `reservation_sheet:${row.id}` },
        );
      }
    },
  };
}
