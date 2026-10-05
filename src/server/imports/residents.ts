import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { residence, residenceUnit, resident, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { MAX_SHARE_BASIS, residentKinds } from "@/lib/residences";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { addResidentSchema } from "@/server/residences/schemas";
import { addResident, saveShares } from "@/server/residences/service";

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

export const residentsSheet: TemplateSheet = {
  name: { fr: "Copropriétaires", ar: "الملاك المشتركون" },
  columns: [
    {
      key: "unit",
      fr: "Code lot",
      ar: "رمز الوحدة",
      required: true,
      help: help("Lot de la résidence.", "وحدة من الإقامة."),
    },
    {
      key: "share",
      fr: "Tantièmes",
      ar: "الحصة",
      help: help(
        "Quote-part du lot (nombre entier) ; vide = inchangée.",
        "حصة الوحدة (عدد صحيح)؛ فارغ = دون تغيير.",
      ),
    },
    {
      key: "kind",
      fr: "Qualité",
      ar: "الصفة",
      help: help("Copropriétaire (par défaut) ou occupant.", "مالك مشترك (افتراضياً) أو شاغل."),
    },
    {
      key: "main",
      fr: "Principal",
      ar: "رئيسي",
      help: help(
        "Oui / non ; par défaut le premier du lot.",
        "نعم / لا؛ افتراضياً الأول في الوحدة.",
      ),
    },
    {
      key: "lastName",
      fr: "Nom",
      ar: "اللقب",
      help: help("Vide = seulement les tantièmes du lot.", "فارغ = حصة الوحدة فقط."),
    },
    { key: "firstName", fr: "Prénom", ar: "الاسم", help: help("Libre.", "حر.") },
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
    { key: "phone", fr: "Téléphone", ar: "الهاتف", help: help("Facultatif.", "اختياري.") },
    {
      key: "email",
      fr: "E-mail",
      ar: "البريد الإلكتروني",
      help: help("Pour l'espace client.", "لفضاء الزبائن."),
    },
    {
      key: "address",
      fr: "Adresse",
      ar: "العنوان",
      help: help("Si différente du lot.", "إذا كان مختلفاً عن الوحدة."),
    },
    { key: "sinceOn", fr: "Depuis le", ar: "منذ", help: help("jj/mm/aaaa.", "يوم/شهر/سنة.") },
    {
      key: "whatsapp",
      fr: "WhatsApp",
      ar: "واتساب",
      help: help("Oui s'il accepte les notifications.", "نعم إذا وافق على الإشعارات."),
    },
  ],
  example: {
    unit: "A-01-01",
    share: 350,
    kind: "Copropriétaire",
    lastName: "Saïdi",
    firstName: "Yasmine",
    phone: "0661 11 22 33",
  },
};

const kindSynonyms = {
  coproprietaire: "co_owner",
  proprietaire: "co_owner",
  "co proprietaire": "co_owner",
  locataire: "occupant",
  occupant: "occupant",
} as const satisfies Record<string, (typeof residentKinds)[number]>;

/**
 * Co-owners, occupants and shares of a residence (CLAUDE.md §7 Imports): units must belong to
 * the residence; the shares given replace theirs; a person already current on the unit is left
 * aside (warning); the first of each unit is its main co-owner unless the file says otherwise.
 */
export async function prepareResidents(
  ctx: TenantCtx,
  workbook: Workbook,
  options: { residenceId: string },
): Promise<ImportPlan> {
  assertCan(ctx, "residence:update");
  const issues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const report = issuesOf(residentsSheet, issues);
  const warn = issuesOf(residentsSheet, warnings);
  const rows = sheetRows(workbook, residentsSheet.name, residentsSheet.columns, issues);
  const { units, people } = await withTenant(ctx, async (tx) => {
    const [home] = await tx
      .select({ id: residence.id })
      .from(residence)
      .where(and(eq(residence.id, options.residenceId), isNull(residence.deletedAt)));
    if (!home) throw new AppError("NOT_FOUND");
    return {
      units: await tx
        .select({ unitId: residenceUnit.unitId, code: unit.code })
        .from(residenceUnit)
        .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
        .where(eq(residenceUnit.residenceId, options.residenceId)),
      people: await tx
        .select({
          unitId: resident.unitId,
          kind: resident.kind,
          lastName: resident.lastName,
          firstName: resident.firstName,
          isMain: resident.isMain,
        })
        .from(resident)
        .where(
          and(
            eq(resident.residenceId, options.residenceId),
            isNull(resident.deletedAt),
            isNull(resident.untilOn),
          ),
        ),
    };
  });

  const shares = new Map<string, number>();
  const ready: ReturnType<typeof addResidentSchema.parse>[] = [];
  const seenPeople = new Set<string>();

  for (const { row, cells } of rows ?? []) {
    const code = text(cells.unit ?? null);
    const target = units.find((u) => normalize(u.code) === normalize(code));
    if (!target) {
      report.at(row, "unit", "imports.errors.unitNotInResidence", { code });
      continue;
    }
    const shareText = text(cells.share ?? null);
    if (shareText !== "") {
      const share = Number(shareText);
      if (!Number.isInteger(share) || share < 0 || share > MAX_SHARE_BASIS) {
        report.at(row, "share", "imports.errors.share");
        continue;
      }
      if (shares.has(target.unitId) && shares.get(target.unitId) !== share) {
        report.at(row, "share", "imports.errors.shareTwice", { code: target.code });
        continue;
      }
      shares.set(target.unitId, share);
    }
    const lastName = text(cells.lastName ?? null);
    if (lastName === "") continue;
    const kindText = text(cells.kind ?? null);
    const kind =
      kindText === ""
        ? "co_owner"
        : choice(cells.kind ?? null, residentKinds, "residences.residents.kind", kindSynonyms);
    if (kind === null) {
      report.at(row, "kind", "imports.errors.choice", { value: kindText });
      continue;
    }
    const sinceOn = date(cells.sinceOn ?? null);
    if (sinceOn === null) {
      report.at(row, "sinceOn", "imports.errors.date");
      continue;
    }
    const whatsapp = text(cells.whatsapp ?? null) === "" ? false : yesNo(cells.whatsapp ?? null);
    if (whatsapp === null) {
      report.at(row, "whatsapp", "imports.errors.yesNo");
      continue;
    }
    const firstName = text(cells.firstName ?? null);
    const person = `${target.unitId}|${kind}|${normalize(`${lastName} ${firstName}`)}`;
    if (
      seenPeople.has(person) ||
      people.some(
        (p) =>
          p.unitId === target.unitId &&
          p.kind === kind &&
          normalize(`${p.lastName} ${p.firstName}`) === normalize(`${lastName} ${firstName}`),
      )
    ) {
      warn.at(row, "lastName", "imports.warnings.residentExists", {
        name: `${lastName} ${firstName}`.trim(),
      });
      continue;
    }
    seenPeople.add(person);
    const mainText = text(cells.main ?? null);
    const firstOfUnit =
      !ready.some((r) => r.unitId === target.unitId && r.kind === kind) &&
      !people.some((p) => p.unitId === target.unitId && p.kind === kind && p.isMain);
    const main = mainText === "" ? firstOfUnit : yesNo(cells.main ?? null);
    if (main === null) {
      report.at(row, "main", "imports.errors.yesNo");
      continue;
    }
    const parsed = addResidentSchema.safeParse({
      residenceId: options.residenceId,
      unitId: target.unitId,
      kind,
      isMain: main,
      lastName,
      firstName,
      lastNameAr: text(cells.lastNameAr ?? null),
      firstNameAr: text(cells.firstNameAr ?? null),
      phone: phone(cells.phone ?? null),
      whatsappOptIn: whatsapp,
      email: text(cells.email ?? null),
      address: text(cells.address ?? null),
      sinceOn: sinceOn ?? "",
      notes: "",
    });
    if (!parsed.success) {
      report.zod(row, parsed.error, { isMain: "main", whatsappOptIn: "whatsapp" });
      continue;
    }
    ready.push(parsed.data);
  }

  return {
    counts: { shares: shares.size, residents: ready.length },
    issues,
    warnings,
    apply: async (tx) => {
      if (shares.size > 0) {
        await saveShares(
          ctx,
          {
            residenceId: options.residenceId,
            shares: [...shares].map(([unitId, share]) => ({ unitId, share })),
          },
          tx,
        );
      }
      for (const person of ready) await addResident(ctx, person, tx);
    },
  };
}
