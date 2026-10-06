import "server-only";

import type { Locale } from "@/i18n/locales";
import { type ExportSheet, buildWorkbook } from "@/server/exports/xlsx";

import { bankStatementSheet } from "./bank-statement";
import { buyersSheet } from "./buyers";
import { leadsSheet } from "./leads";
import type { TemplateSheet } from "./plan";
import { residentsSheet } from "./residents";
import { salesSheets } from "./sales";
import type { ImportKind } from "./schemas";
import { unitsSheet } from "./units";

export const templateSheets: Record<ImportKind, TemplateSheet[]> = {
  units: [unitsSheet],
  buyers: [buyersSheet],
  sales: [salesSheets.sales, salesSheets.installments, salesSheets.payments],
  residents: [residentsSheet],
  leads: [leadsSheet],
  bank_statement: [bankStatementSheet],
};

const fileNames: Record<ImportKind, string> = {
  units: "modele-lots.xlsx",
  buyers: "modele-acquereurs.xlsx",
  sales: "modele-ventes.xlsx",
  residents: "modele-coproprietaires.xlsx",
  leads: "modele-prospects.xlsx",
  bank_statement: "modele-releve-bancaire.xlsx",
};

/**
 * The template of an import: its sheets with their headers (in the member's language; both are
 * recognized) and an example row to replace, then a help sheet describing every column.
 */
export async function buildTemplate(
  kind: ImportKind,
  locale: Locale,
): Promise<{ file: string; bytes: Buffer }> {
  const sheets = templateSheets[kind];
  const data: ExportSheet[] = sheets.map((sheet) => ({
    name: sheet.name[locale],
    columns: sheet.columns.map((c) => {
      const example = sheet.example[c.key];
      return {
        header: c[locale],
        width: Math.max(14, c[locale].length + 4),
        kind:
          typeof example === "number"
            ? Number.isInteger(example)
              ? ("integer" as const)
              : ("area" as const)
            : ("text" as const),
      };
    }),
    rows: [sheet.columns.map((c) => sheet.example[c.key] ?? null)],
  }));
  const fr = locale === "fr";
  data.push({
    name: fr ? "Aide" : "مساعدة",
    columns: [
      { header: fr ? "Feuille" : "الورقة", width: 18 },
      { header: fr ? "Colonne" : "العمود", width: 30 },
      { header: fr ? "Obligatoire" : "إجباري", width: 12 },
      { header: fr ? "Contenu" : "المحتوى", width: 80 },
    ],
    rows: sheets.flatMap((sheet) =>
      sheet.columns.map((c) => [
        sheet.name[locale],
        c[locale],
        c.required ? (fr ? "Oui" : "نعم") : "",
        c.help[locale],
      ]),
    ),
  });
  return { file: fileNames[kind], bytes: await buildWorkbook(data, { rightToLeft: !fr }) };
}
