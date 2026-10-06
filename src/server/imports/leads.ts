import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { lead, member, project, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { financingModes, leadSources } from "@/lib/crm";
import { typologies } from "@/lib/inventory";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { seesAllLeads } from "@/server/crm/access";
import { createLead } from "@/server/crm/leads";
import { createLeadSchema } from "@/server/crm/schemas";

import { type ImportPlan, issuesOf, type TemplateSheet } from "./plan";
import {
  choice,
  type ImportIssue,
  money,
  normalize,
  phone,
  sheetRows,
  text,
  type Workbook,
} from "./sheets";

const help = (fr: string, ar: string) => ({ fr, ar });

export const leadsSheet: TemplateSheet = {
  name: { fr: "Prospects", ar: "العملاء المحتملون" },
  columns: [
    {
      key: "fullName",
      fr: "Nom complet",
      ar: "الاسم الكامل",
      required: true,
      help: help("Obligatoire.", "إجباري."),
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
    { key: "city", fr: "Ville", ar: "المدينة", help: help("Libre.", "حر.") },
    {
      key: "source",
      fr: "Source",
      ar: "المصدر",
      help: help(
        "Facebook, Instagram, WhatsApp, Ouedkniss, passage, recommandation, appel, site web, autre (par défaut).",
        "فيسبوك، إنستغرام، واتساب، واد كنيس، زيارة، توصية، مكالمة، الموقع، أخرى (افتراضياً).",
      ),
    },
    {
      key: "sourceDetail",
      fr: "Précision sur la source",
      ar: "تفاصيل المصدر",
      help: help("Campagne, apporteur…", "الحملة، الوسيط…"),
    },
    {
      key: "project",
      fr: "Code projet",
      ar: "رمز المشروع",
      help: help("Le projet qui l'intéresse (ex. OLIV).", "المشروع الذي يهمه (مثال OLIV)."),
    },
    {
      key: "typologies",
      fr: "Typologies",
      ar: "الأصناف",
      help: help("F2, F3… séparées par des virgules.", "F2، F3… مفصولة بفواصل."),
    },
    { key: "budget", fr: "Budget (DA)", ar: "الميزانية (دج)", help: help("Montant.", "المبلغ.") },
    {
      key: "financing",
      fr: "Financement",
      ar: "التمويل",
      help: help("Comptant, crédit bancaire, mixte.", "نقداً، قرض بنكي، مختلط."),
    },
    {
      key: "commercial",
      fr: "Commercial (e-mail)",
      ar: "المكلّف بالمبيعات (البريد)",
      help: help(
        "Pour un responsable : le commercial à qui l'attribuer ; vide = non attribué.",
        "للمسؤول: المكلّف الذي يُسند إليه؛ فارغ = غير مسند.",
      ),
    },
    { key: "notes", fr: "Remarques", ar: "ملاحظات", help: help("Libre.", "حر.") },
  ],
  example: {
    fullName: "Karim Bensalem",
    phone: "0661 50 12 34",
    city: "Kouba",
    source: "Facebook",
    project: "OLIV",
    typologies: "F3, F4",
    budget: 14000000,
    financing: "Crédit bancaire",
  },
};

const sourceSynonyms = {
  fb: "facebook",
  insta: "instagram",
  ig: "instagram",
  passage: "walk_in",
  "passage au bureau": "walk_in",
  visite: "walk_in",
  bureau: "walk_in",
  recommandation: "referral",
  parrainage: "referral",
  apporteur: "referral",
  appel: "phone",
  telephone: "phone",
  "appel entrant": "phone",
  site: "website",
  "site web": "website",
  web: "website",
  formulaire: "website",
  autre: "other",
} as const satisfies Record<string, (typeof leadSources)[number]>;

const financingSynonyms = {
  comptant: "cash",
  cash: "cash",
  credit: "bank_loan",
  "credit bancaire": "bank_loan",
  banque: "bank_loan",
  mixte: "mixed",
} as const satisfies Record<string, (typeof financingModes)[number]>;

/**
 * Leads (CLAUDE.md §7 Imports), from the template or a CSV export (Facebook Lead Ads, a
 * website's forms): a lead whose phone is already a live lead's is left aside (warning); a
 * manager may assign each to a commercial by e-mail, a commercial's leads are theirs.
 */
export async function prepareLeads(ctx: TenantCtx, workbook: Workbook): Promise<ImportPlan> {
  assertCan(ctx, "lead:create");
  const issues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const report = issuesOf(leadsSheet, issues);
  const warn = issuesOf(leadsSheet, warnings);
  const rows = sheetRows(workbook, leadsSheet.name, leadsSheet.columns, issues);
  const data = await withTenant(ctx, async (tx) => ({
    phones: await tx
      .select({ phone: lead.phone, phone2: lead.phone2 })
      .from(lead)
      .where(isNull(lead.deletedAt)),
    projects: await tx
      .select({ id: project.id, code: project.code })
      .from(project)
      .where(isNull(project.deletedAt)),
    members: await tx
      .select({ userId: member.userId, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, ctx.orgId))),
  }));
  const taken = new Set(data.phones.flatMap((p) => [p.phone, p.phone2]).filter(Boolean));
  const seen = new Set<string>();
  const ready: ReturnType<typeof createLeadSchema.parse>[] = [];

  for (const { row, cells } of rows ?? []) {
    const sourceText = text(cells.source ?? null);
    const source =
      sourceText === ""
        ? "other"
        : choice(cells.source ?? null, leadSources, "crm.source", sourceSynonyms);
    if (source === null) {
      report.at(row, "source", "imports.errors.choice", { value: sourceText });
      continue;
    }
    const financingText = text(cells.financing ?? null);
    const financing =
      financingText === ""
        ? ""
        : choice(cells.financing ?? null, financingModes, "crm.financing", financingSynonyms);
    if (financing === null) {
      report.at(row, "financing", "imports.errors.choice", { value: financingText });
      continue;
    }
    const projectCode = text(cells.project ?? null);
    const target =
      projectCode === ""
        ? null
        : data.projects.find((p) => normalize(p.code) === normalize(projectCode));
    if (target === undefined) {
      report.at(row, "project", "imports.errors.projectNotFound", { code: projectCode });
      continue;
    }
    const wanted = text(cells.typologies ?? null)
      .toUpperCase()
      .split(/[\s,;/]+/)
      .filter(Boolean);
    const unknownTypology = wanted.find((w) => !(typologies as readonly string[]).includes(w));
    if (unknownTypology) {
      report.at(row, "typologies", "imports.errors.choice", { value: unknownTypology });
      continue;
    }
    const email = text(cells.commercial ?? null).toLowerCase();
    const commercial =
      email === "" ? null : data.members.find((m) => m.email.toLowerCase() === email);
    if (commercial === undefined) {
      report.at(row, "commercial", "imports.errors.memberNotFound", { value: email });
      continue;
    }
    const parsed = createLeadSchema.safeParse({
      fullName: text(cells.fullName ?? null),
      phone: phone(cells.phone ?? null),
      phone2: phone(cells.phone2 ?? null),
      email: text(cells.email ?? null),
      city: text(cells.city ?? null),
      source,
      sourceDetail: text(cells.sourceDetail ?? null),
      projectId: target?.id ?? "",
      typologies: [...new Set(wanted)],
      budget: text(cells.budget ?? null) === "" ? "" : money(cells.budget ?? null),
      financing,
      notes: text(cells.notes ?? null),
      assignedTo: seesAllLeads(ctx) ? (commercial?.userId ?? "") : "",
    });
    if (!parsed.success) {
      report.zod(row, parsed.error, { assignedTo: "commercial", projectId: "project" });
      continue;
    }
    const person = parsed.data;
    if (seen.has(person.phone)) {
      report.at(row, "phone", "imports.errors.duplicateInFile", { value: person.phone });
      continue;
    }
    seen.add(person.phone);
    if (taken.has(person.phone)) {
      warn.at(row, "phone", "imports.warnings.leadExists", { name: person.fullName });
      continue;
    }
    ready.push(person);
  }

  return {
    counts: { leads: ready.length },
    issues,
    warnings,
    apply: async (tx) => {
      for (const person of ready) await createLead(ctx, person, tx);
    },
  };
}
