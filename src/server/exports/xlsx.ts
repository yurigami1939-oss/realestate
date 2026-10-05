import "server-only";

import writeXlsxFile, { type Cell, type Sheet } from "write-excel-file/node";

/** How a column's values are written: Excel numbers and dates, so sums and filters work. */
export type ColumnKind = "text" | "money" | "date" | "datetime" | "integer" | "area";

export type ExportColumn = { header: string; kind?: ColumnKind; width?: number };
export type ExportValue = string | number | bigint | Date | null | undefined;
export type ExportSheet = { name: string; columns: ExportColumn[]; rows: ExportValue[][] };

/** A spreadsheet too large to build in a request: the user narrows the filters. */
export const MAX_EXPORT_ROWS = 50_000;

const AMOUNT_FORMAT = "#,##0.00";
const AREA_FORMAT = "#,##0.00";
const DATE_FORMAT = "dd/mm/yyyy";
const DATETIME_FORMAT = "dd/mm/yyyy hh:mm";
const ALGIERS_OFFSET_MS = 60 * 60 * 1000;

const widths: Record<ColumnKind, number> = {
  text: 24,
  money: 16,
  date: 12,
  datetime: 17,
  integer: 10,
  area: 11,
};

/**
 * Centimes as dinars for a spreadsheet cell — the one place money becomes a JS number
 * (CLAUDE.md §12): spreadsheet cells are doubles, exact far beyond any amount here.
 */
export function excelAmount(amount: bigint): number {
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (amount > limit || amount < -limit) throw new Error("excelAmount: amount out of range");
  return Number(amount) / 100;
}

function toCell(value: ExportValue, kind: ColumnKind): Cell {
  if (value === null || value === undefined || value === "") return null;
  switch (kind) {
    case "money":
      return {
        value: typeof value === "bigint" ? excelAmount(value) : Number(value),
        type: Number,
        format: AMOUNT_FORMAT,
      };
    case "area":
      return { value: Number(value), type: Number, format: AREA_FORMAT };
    case "integer":
      return { value: Number(value), type: Number };
    case "date":
      // A calendar day ("YYYY-MM-DD"): Excel dates carry no time zone.
      return {
        value: value instanceof Date ? value : new Date(`${String(value)}T00:00:00Z`),
        type: Date,
        format: DATE_FORMAT,
      };
    case "datetime":
      // An instant, shown at its Algiers wall-clock time (UTC+1, no daylight saving).
      return {
        value: new Date(
          (value instanceof Date ? value : new Date(String(value))).getTime() + ALGIERS_OFFSET_MS,
        ),
        type: Date,
        format: DATETIME_FORMAT,
      };
    case "text":
      return { value: String(value), type: String };
  }
}

/**
 * An .xlsx workbook: one sheet per entry, a bold frozen header row, typed cells (amounts in
 * dinars with two decimals, real dates), right to left for Arabic.
 */
export async function buildWorkbook(
  sheets: ExportSheet[],
  options: { rightToLeft: boolean },
): Promise<Buffer> {
  const data: Sheet<Buffer>[] = sheets.map((sheet) => {
    if (sheet.rows.length > MAX_EXPORT_ROWS) throw new Error("buildWorkbook: too many rows");
    return {
      // Excel's limits: 31 characters, none of : \ / ? * [ ].
      sheet: sheet.name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31),
      data: [
        sheet.columns.map((c) => ({ value: c.header, type: String, fontWeight: "bold" as const })),
        ...sheet.rows.map((row) =>
          row.map((value, i) => toCell(value, sheet.columns[i]?.kind ?? "text")),
        ),
      ],
      columns: sheet.columns.map((c) => ({ width: c.width ?? widths[c.kind ?? "text"] })),
      stickyRowsCount: 1,
      rightToLeft: options.rightToLeft,
    };
  });
  return writeXlsxFile(data, { fontFamily: "Calibri", fontSize: 11 }).toBuffer();
}

/** `ventes-2026-10-05.xlsx`: ASCII, safe in every browser and file system. */
export const exportFileName = (base: string, suffix: string) =>
  `${base}-${suffix}.xlsx`.replace(/[^A-Za-z0-9._-]/g, "_");
