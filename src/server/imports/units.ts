import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { building, project, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { type orientations, unitTypes } from "@/lib/inventory";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { moneyText } from "@/lib/zod";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { createUnitSchema } from "@/server/inventory/schemas";
import { blockUnit, createUnit, updateUnitPrice } from "@/server/inventory/service";

import { IMPORT_REASON, type ImportPlan, issuesOf, type TemplateSheet } from "./plan";
import {
  area,
  choice,
  type ImportIssue,
  money,
  normalize,
  sheetRows,
  text,
  type Workbook,
  yesNo,
} from "./sheets";

export const unitsSheet: TemplateSheet = {
  name: { fr: "Lots", ar: "الوحدات" },
  columns: [
    {
      key: "building",
      fr: "Bâtiment",
      ar: "العمارة",
      required: true,
      help: {
        fr: "Code du bâtiment, déjà créé dans le projet (ex. A).",
        ar: "رمز العمارة المنشأة في المشروع (مثال A).",
      },
    },
    {
      key: "code",
      fr: "Code lot",
      ar: "رمز الوحدة",
      required: true,
      help: { fr: "Unique dans le projet (ex. A-03-02).", ar: "فريد في المشروع (مثال A-03-02)." },
    },
    {
      key: "floor",
      fr: "Étage",
      ar: "الطابق",
      required: true,
      help: {
        fr: "Nombre : 0 ou RDC pour le rez-de-chaussée, -1 pour le premier sous-sol.",
        ar: "رقم: 0 للطابق الأرضي، 1- للطابق السفلي الأول.",
      },
    },
    {
      key: "type",
      fr: "Type",
      ar: "النوع",
      help: {
        fr: "Appartement (par défaut), local, bureau, parking, cave, villa.",
        ar: "شقة (افتراضياً)، محل، مكتب، موقف سيارات، قبو، فيلا.",
      },
    },
    {
      key: "typology",
      fr: "Typologie",
      ar: "الصنف",
      help: { fr: "F1 à F6.", ar: "من F1 إلى F6." },
    },
    { key: "duplex", fr: "Duplex", ar: "دوبلكس", help: { fr: "Oui / non.", ar: "نعم / لا." } },
    {
      key: "livingArea",
      fr: "Surface habitable (m²)",
      ar: "المساحة الصالحة للسكن (م²)",
      help: { fr: "Ex. 86,75.", ar: "مثال 86,75." },
    },
    {
      key: "usableArea",
      fr: "Surface utile (m²)",
      ar: "المساحة النافعة (م²)",
      help: { fr: "Locaux, bureaux, parkings.", ar: "للمحلات والمكاتب والمواقف." },
    },
    {
      key: "outdoorArea",
      fr: "Surface extérieure (m²)",
      ar: "المساحة الخارجية (م²)",
      help: { fr: "Terrasse, jardin.", ar: "شرفة، حديقة." },
    },
    {
      key: "orientations",
      fr: "Orientations",
      ar: "الاتجاهات",
      help: { fr: "N, S, E, O… séparées par des virgules.", ar: "N, S, E, W… مفصولة بفواصل." },
    },
    {
      key: "share",
      fr: "Quote-part",
      ar: "الحصة",
      help: { fr: "Tantièmes du lot (nombre entier).", ar: "حصة الوحدة (عدد صحيح)." },
    },
    {
      key: "price",
      fr: "Prix (DA)",
      ar: "السعر (دج)",
      help: { fr: "Prix catalogue actuel.", ar: "سعر القائمة الحالي." },
    },
    {
      key: "blocked",
      fr: "Bloqué (motif)",
      ar: "محجوز (السبب)",
      help: {
        fr: "Si le lot est réservé par la société : le motif (sinon vide).",
        ar: "إذا احتفظت الشركة بالوحدة: السبب (وإلا فارغ).",
      },
    },
    { key: "notes", fr: "Remarques", ar: "ملاحظات", help: { fr: "Libre.", ar: "حر." } },
  ],
  example: {
    building: "A",
    code: "A-03-02",
    floor: 3,
    type: "Appartement",
    typology: "F3",
    duplex: "non",
    livingArea: 86.75,
    price: 13010000,
  },
};

const typeSynonyms = {
  appartement: "apartment",
  appart: "apartment",
  logement: "apartment",
  local: "commercial",
  "local commercial": "commercial",
  commerce: "commercial",
  bureau: "office",
  place: "parking",
  "place de parking": "parking",
  garage: "parking",
  box: "storage",
  cave: "storage",
  cellier: "storage",
} as const satisfies Record<string, (typeof unitTypes)[number]>;

/** French orientations (O = ouest) and their English codes. */
const orientationSynonyms: Record<string, (typeof orientations)[number]> = {
  o: "W",
  no: "NW",
  so: "SW",
  nord: "N",
  sud: "S",
  est: "E",
  ouest: "W",
};

function floorOf(value: ReturnType<typeof text>): number | null {
  const v = normalize(value);
  if (v === "rdc" || v === "rez de chaussee") return 0;
  return /^-?\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : null;
}

/**
 * Units of a project (CLAUDE.md §7 Imports): buildings must exist; units already there are
 * left aside (warning); each new unit is created available, then priced and blocked when the
 * file says so (histories and audit as by hand).
 */
export async function prepareUnits(
  ctx: TenantCtx,
  workbook: Workbook,
  options: { projectId: string },
): Promise<ImportPlan> {
  assertCan(ctx, "unit:create");
  const issues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const report = issuesOf(unitsSheet, issues);
  const warn = issuesOf(unitsSheet, warnings);
  const rows = sheetRows(workbook, unitsSheet.name, unitsSheet.columns, issues);
  const { buildings, existing } = await withTenant(ctx, async (tx) => {
    const [owner] = await tx
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, options.projectId), isNull(project.deletedAt)));
    if (!owner) throw new AppError("NOT_FOUND");
    return {
      buildings: await tx
        .select()
        .from(building)
        .where(and(eq(building.projectId, options.projectId), isNull(building.deletedAt))),
      existing: await tx
        .select({ code: unit.code })
        .from(unit)
        .where(and(eq(unit.projectId, options.projectId), isNull(unit.deletedAt))),
    };
  });
  const taken = new Set(existing.map((u) => normalize(u.code)));
  const seen = new Set<string>();
  type Ready = {
    input: ReturnType<typeof createUnitSchema.parse>;
    price: bigint | null;
    blocked: string;
  };
  const ready: Ready[] = [];

  for (const { row, cells } of rows ?? []) {
    const code = text(cells.code ?? null).toUpperCase();
    if (seen.has(normalize(code))) {
      report.at(row, "code", "imports.errors.duplicateInFile", { value: code });
      continue;
    }
    seen.add(normalize(code));
    if (taken.has(normalize(code))) {
      warn.at(row, "code", "imports.warnings.unitExists", { code });
      continue;
    }
    const buildingCode = text(cells.building ?? null);
    const home = buildings.find((b) => normalize(b.code) === normalize(buildingCode));
    if (!home) {
      report.at(row, "building", "imports.errors.buildingNotFound", { code: buildingCode });
      continue;
    }
    const floor = floorOf(text(cells.floor ?? null));
    if (floor === null) {
      report.at(row, "floor", "imports.errors.floor");
      continue;
    }
    if (floor < home.lowestFloor || floor > home.topFloor) {
      report.at(row, "floor", "imports.errors.floorOutOfRange", { floor, building: home.code });
      continue;
    }
    const type =
      text(cells.type ?? null) === ""
        ? "apartment"
        : choice(cells.type ?? null, unitTypes, "inventory.unitType", typeSynonyms);
    if (type === null) {
      report.at(row, "type", "imports.errors.choice", { value: text(cells.type ?? null) });
      continue;
    }
    const duplex = text(cells.duplex ?? null) === "" ? false : yesNo(cells.duplex ?? null);
    if (duplex === null) {
      report.at(row, "duplex", "imports.errors.yesNo");
      continue;
    }
    const orientationList = text(cells.orientations ?? null)
      .split(/[\s,;/]+/)
      .filter(Boolean)
      .map((o) => orientationSynonyms[o.toLowerCase()] ?? o.toUpperCase());
    const parsed = createUnitSchema.safeParse({
      buildingId: home.id,
      code,
      floor: String(floor),
      type,
      typology: text(cells.typology ?? null).toUpperCase(),
      isDuplex: duplex,
      livingArea: area(cells.livingArea ?? null),
      usableArea: area(cells.usableArea ?? null),
      outdoorArea: area(cells.outdoorArea ?? null),
      orientations: [...new Set(orientationList)],
      share: text(cells.share ?? null),
      notes: text(cells.notes ?? null),
    });
    if (!parsed.success) {
      report.zod(row, parsed.error, { isDuplex: "duplex" });
      continue;
    }
    let price: bigint | null = null;
    if (text(cells.price ?? null) !== "") {
      const amount = moneyText().safeParse(money(cells.price ?? null));
      if (!amount.success || amount.data <= 0n) {
        report.at(row, "price", "validation.amount");
        continue;
      }
      price = amount.data;
    }
    ready.push({ input: parsed.data, price, blocked: text(cells.blocked ?? null) });
  }
  if (ready.some((r) => r.price !== null) && !can(ctx.roles, "price:update")) {
    report.at(null, "price", "errors.FORBIDDEN");
  }
  if (ready.some((r) => r.blocked !== "") && !can(ctx.roles, "unit:block")) {
    report.at(null, "blocked", "errors.FORBIDDEN");
  }

  return {
    counts: { units: ready.length },
    issues,
    warnings,
    apply: async (tx) => {
      for (const r of ready) {
        const { id } = await createUnit(ctx, r.input, tx);
        if (r.price !== null) {
          await updateUnitPrice(ctx, { unitId: id, price: r.price, reason: IMPORT_REASON }, tx);
        }
        if (r.blocked !== "") await blockUnit(ctx, { unitId: id, reason: r.blocked }, tx);
      }
    },
  };
}
