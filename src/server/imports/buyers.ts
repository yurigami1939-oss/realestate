import "server-only";

import { isNull } from "drizzle-orm";

import { buyer } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { civilities, maritalStatuses } from "@/lib/sales";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";

import { type ImportPlan, issuesOf, type TemplateSheet } from "./plan";
import {
  choice,
  date,
  type ImportIssue,
  normalize,
  phone,
  sheetRows,
  text,
  type Workbook,
  yesNo,
} from "./sheets";

const help = (fr: string, ar: string) => ({ fr, ar });

export const buyersSheet: TemplateSheet = {
  name: { fr: "Acquéreurs", ar: "المشترون" },
  columns: [
    {
      key: "civility",
      fr: "Civilité",
      ar: "اللقب الشرفي",
      help: help("M. ou Mme.", "السيد أو السيدة."),
    },
    {
      key: "lastName",
      fr: "Nom",
      ar: "اللقب",
      required: true,
      help: help("Obligatoire.", "إجباري."),
    },
    {
      key: "firstName",
      fr: "Prénom",
      ar: "الاسم",
      required: true,
      help: help("Obligatoire.", "إجباري."),
    },
    {
      key: "lastNameAr",
      fr: "Nom (arabe)",
      ar: "اللقب (بالعربية)",
      help: help("En arabe.", "بالعربية."),
    },
    {
      key: "firstNameAr",
      fr: "Prénom (arabe)",
      ar: "الاسم (بالعربية)",
      help: help("En arabe.", "بالعربية."),
    },
    {
      key: "birthDate",
      fr: "Date de naissance",
      ar: "تاريخ الميلاد",
      help: help("jj/mm/aaaa.", "يوم/شهر/سنة."),
    },
    {
      key: "birthPlace",
      fr: "Lieu de naissance",
      ar: "مكان الميلاد",
      help: help("Commune.", "البلدية."),
    },
    { key: "fatherFirstName", fr: "Prénom du père", ar: "اسم الأب", help: help("Libre.", "حر.") },
    {
      key: "motherFullName",
      fr: "Nom et prénom de la mère",
      ar: "لقب واسم الأم",
      help: help("Libre.", "حر."),
    },
    {
      key: "nin",
      fr: "NIN",
      ar: "رقم التعريف الوطني",
      help: help(
        "18 chiffres ; sert à retrouver l'acquéreur dans l'import des ventes.",
        "18 رقماً؛ يُستعمل للعثور على المشتري عند استيراد المبيعات.",
      ),
    },
    { key: "idCardNumber", fr: "N° CNI", ar: "رقم بطاقة التعريف", help: help("Libre.", "حر.") },
    {
      key: "idCardIssuedOn",
      fr: "CNI délivrée le",
      ar: "تاريخ إصدار البطاقة",
      help: help("jj/mm/aaaa.", "يوم/شهر/سنة."),
    },
    {
      key: "idCardIssuedBy",
      fr: "CNI délivrée par",
      ar: "جهة إصدار البطاقة",
      help: help("Libre.", "حر."),
    },
    {
      key: "phone",
      fr: "Téléphone",
      ar: "الهاتف",
      required: true,
      help: help("Obligatoire (0661 50 12 34 ou +213…).", "إجباري (0661 50 12 34 أو +213…)."),
    },
    { key: "phone2", fr: "Téléphone 2", ar: "الهاتف 2", help: help("Facultatif.", "اختياري.") },
    { key: "email", fr: "E-mail", ar: "البريد الإلكتروني", help: help("Facultatif.", "اختياري.") },
    { key: "address", fr: "Adresse", ar: "العنوان", help: help("Libre.", "حر.") },
    { key: "commune", fr: "Commune", ar: "البلدية", help: help("Libre.", "حر.") },
    { key: "wilaya", fr: "Wilaya", ar: "الولاية", help: help("Libre.", "حر.") },
    { key: "profession", fr: "Profession", ar: "المهنة", help: help("Libre.", "حر.") },
    { key: "employer", fr: "Employeur", ar: "المستخدِم", help: help("Libre.", "حر.") },
    {
      key: "maritalStatus",
      fr: "Situation familiale",
      ar: "الحالة العائلية",
      help: help("Célibataire, marié(e), divorcé(e), veuf(ve).", "أعزب، متزوج، مطلق، أرمل."),
    },
    {
      key: "whatsapp",
      fr: "WhatsApp",
      ar: "واتساب",
      help: help(
        "Oui si l'acquéreur accepte les notifications WhatsApp.",
        "نعم إذا وافق المشتري على إشعارات واتساب.",
      ),
    },
    { key: "notes", fr: "Remarques", ar: "ملاحظات", help: help("Libre.", "حر.") },
  ],
  example: {
    civility: "M.",
    lastName: "Bensalem",
    firstName: "Karim",
    nin: "109870123456789012",
    phone: "0661 50 12 34",
    wilaya: "16 - Alger",
    whatsapp: "oui",
  },
};

const civilitySynonyms = {
  m: "mr",
  monsieur: "mr",
  mr: "mr",
  mme: "mrs",
  madame: "mrs",
  mlle: "mrs",
  mademoiselle: "mrs",
} as const satisfies Record<string, (typeof civilities)[number]>;

const maritalSynonyms = {
  celibataire: "single",
  marie: "married",
  mariee: "married",
  "marie e": "married",
  divorce: "divorced",
  divorcee: "divorced",
  "divorce e": "divorced",
  veuf: "widowed",
  veuve: "widowed",
  "veuf ve": "widowed",
} as const satisfies Record<string, (typeof maritalStatuses)[number]>;

/**
 * Buyer files (CLAUDE.md §7 Imports): a file already there (same NIN, or same phone and
 * name) is left aside (warning); the others are created, followed by the importing member.
 */
export async function prepareBuyers(ctx: TenantCtx, workbook: Workbook): Promise<ImportPlan> {
  assertCan(ctx, "buyer:create");
  assertCan(ctx, "buyer:read_all");
  const issues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const report = issuesOf(buyersSheet, issues);
  const warn = issuesOf(buyersSheet, warnings);
  const rows = sheetRows(workbook, buyersSheet.name, buyersSheet.columns, issues);
  const existing = await withTenant(ctx, (tx) =>
    tx
      .select({ nin: buyer.nin, phone: buyer.phone, lastName: buyer.lastName })
      .from(buyer)
      .where(isNull(buyer.deletedAt)),
  );
  const ninsTaken = new Set(existing.flatMap((b) => (b.nin ? [b.nin] : [])));
  const peopleTaken = new Set(existing.map((b) => `${b.phone}|${normalize(b.lastName)}`));
  const seen = new Set<string>();
  const ready: ReturnType<typeof createBuyerSchema.parse>[] = [];

  for (const { row, cells } of rows ?? []) {
    const dates = {
      birthDate: date(cells.birthDate ?? null),
      idCardIssuedOn: date(cells.idCardIssuedOn ?? null),
    };
    const badDate = Object.entries(dates).find(([, value]) => value === null);
    if (badDate) {
      report.at(row, badDate[0], "imports.errors.date");
      continue;
    }
    const civilityText = text(cells.civility ?? null);
    const civility =
      civilityText === ""
        ? ""
        : choice(cells.civility ?? null, civilities, "buyers.civility", civilitySynonyms);
    const maritalText = text(cells.maritalStatus ?? null);
    const marital =
      maritalText === ""
        ? ""
        : choice(
            cells.maritalStatus ?? null,
            maritalStatuses,
            "buyers.maritalStatus",
            maritalSynonyms,
          );
    if (civility === null) {
      report.at(row, "civility", "imports.errors.choice", { value: civilityText });
      continue;
    }
    if (marital === null) {
      report.at(row, "maritalStatus", "imports.errors.choice", { value: maritalText });
      continue;
    }
    const whatsapp = text(cells.whatsapp ?? null) === "" ? false : yesNo(cells.whatsapp ?? null);
    if (whatsapp === null) {
      report.at(row, "whatsapp", "imports.errors.yesNo");
      continue;
    }
    const parsed = createBuyerSchema.safeParse({
      civility,
      lastName: text(cells.lastName ?? null),
      firstName: text(cells.firstName ?? null),
      lastNameAr: text(cells.lastNameAr ?? null),
      firstNameAr: text(cells.firstNameAr ?? null),
      birthDate: dates.birthDate ?? "",
      birthPlace: text(cells.birthPlace ?? null),
      fatherFirstName: text(cells.fatherFirstName ?? null),
      motherFullName: text(cells.motherFullName ?? null),
      nin: text(cells.nin ?? null),
      idCardNumber: text(cells.idCardNumber ?? null),
      idCardIssuedOn: dates.idCardIssuedOn ?? "",
      idCardIssuedBy: text(cells.idCardIssuedBy ?? null),
      phone: phone(cells.phone ?? null),
      phone2: phone(cells.phone2 ?? null),
      whatsappOptIn: whatsapp,
      email: text(cells.email ?? null),
      address: text(cells.address ?? null),
      commune: text(cells.commune ?? null),
      wilaya: text(cells.wilaya ?? null),
      profession: text(cells.profession ?? null),
      employer: text(cells.employer ?? null),
      maritalStatus: marital,
      notes: text(cells.notes ?? null),
      leadId: "",
    });
    if (!parsed.success) {
      report.zod(row, parsed.error, { whatsappOptIn: "whatsapp" });
      continue;
    }
    const person = parsed.data;
    const key = person.nin ?? `${person.phone}|${normalize(person.lastName)}`;
    if (seen.has(key)) {
      report.at(row, person.nin ? "nin" : "phone", "imports.errors.duplicateInFile", {
        value: person.nin ?? person.phone,
      });
      continue;
    }
    seen.add(key);
    if (
      (person.nin && ninsTaken.has(person.nin)) ||
      peopleTaken.has(`${person.phone}|${normalize(person.lastName)}`)
    ) {
      warn.at(row, person.nin ? "nin" : "phone", "imports.warnings.buyerExists", {
        name: `${person.lastName} ${person.firstName}`,
      });
      continue;
    }
    ready.push(person);
  }

  return {
    counts: { buyers: ready.length },
    issues,
    warnings,
    apply: async (tx) => {
      for (const person of ready) await createBuyer(ctx, person, tx);
    },
  };
}
