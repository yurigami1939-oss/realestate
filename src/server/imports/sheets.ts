import "server-only";

import readXlsxFile from "read-excel-file/node";

import ar from "../../../messages/ar.json";
import fr from "../../../messages/fr.json";

/** A column of an import sheet: its header in both languages (either is recognized). */
export type ImportColumn = {
  key: string;
  fr: string;
  ar: string;
  required?: boolean;
};

export type CellValue = string | number | boolean | Date | null;

/** One data row: the Excel row number (for messages) and its cells by column key. */
export type SheetRow = { row: number; cells: Record<string, CellValue> };

/** A sheet or column name in both languages. */
export type Label = { fr: string; ar: string };

/** A problem found in the file, shown with its place (sheet, Excel row, column). */
export type ImportIssue = {
  sheet: Label;
  row: number | null;
  column: Label | null;
  messageKey: string;
  values?: Record<string, string | number>;
};

/** Lowercase, no accents, no punctuation: « N° de téléphone » ≈ « n de telephone ». */
export const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u064b-\u0652]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();

export type Workbook = { sheet: string; data: CellValue[][] }[];

/**
 * Reads an .xlsx file, else a CSV export (UTF-8 or UTF-16, separated by `;`, `,` or tabs, e.g.
 * Facebook Lead Ads) as a single sheet; null when it is neither.
 */
export async function readWorkbook(bytes: Buffer): Promise<Workbook | null> {
  // An .xlsx file is a zip archive ("PK").
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      return (await readXlsxFile(bytes)) as Workbook;
    } catch {
      return null;
    }
  }
  const rows = parseCsv(decodeText(bytes));
  return rows ? [{ sheet: "CSV", data: rows }] : null;
}

/** Text of a CSV file: UTF-16 with its byte order mark, else UTF-8 (BOM dropped). */
function decodeText(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  const text = bytes.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const occurrences = (line: string, char: string) => line.split(char).length - 1;

/**
 * Parses CSV text: the separator is the most frequent of `;`, tab and `,` on the header line;
 * quoted fields may hold separators, line breaks and doubled quotes. Null for binary content or
 * an empty file.
 */
export function parseCsv(text: string): CellValue[][] | null {
  if (text.trim() === "" || text.includes("\u0000")) return null;
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    [";", "\t", ","].sort((a, b) => occurrences(header, b) - occurrences(header, a))[0] ?? ";";
  const rows: CellValue[][] = [];
  let row: CellValue[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    const value = field.trim();
    row.push(value === "" ? null : value);
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (char === delimiter) {
      endField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endField();
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    endField();
    rows.push(row);
  }
  return rows.length > 0 ? rows : null;
}

/**
 * The rows of a sheet as cells by column key, matching headers in French or Arabic (row 1);
 * blank rows are skipped. Issues when the sheet or a required column is missing.
 */
export function sheetRows(
  workbook: Workbook,
  names: Label,
  columns: ImportColumn[],
  issues: ImportIssue[],
): SheetRow[] | null {
  const wanted = new Set([normalize(names.fr), normalize(names.ar)]);
  const sheet =
    workbook.find((s) => wanted.has(normalize(s.sheet))) ??
    (workbook.length === 1 ? workbook[0] : undefined);
  if (!sheet) {
    issues.push({
      sheet: names,
      row: null,
      column: null,
      messageKey: "imports.errors.sheetMissing",
    });
    return null;
  }
  const headers = (sheet.data[0] ?? []).map((h) => normalize(String(h ?? "")));
  const index = new Map<string, number>();
  for (const column of columns) {
    const at = headers.findIndex((h) => h === normalize(column.fr) || h === normalize(column.ar));
    if (at >= 0) index.set(column.key, at);
    else if (column.required) {
      issues.push({
        sheet: names,
        row: 1,
        column: { fr: column.fr, ar: column.ar },
        messageKey: "imports.errors.columnMissing",
      });
    }
  }
  if (columns.some((c) => c.required && !index.has(c.key))) return null;
  return sheet.data.slice(1).flatMap((cells, i) => {
    if (cells.every((c) => c === null || String(c).trim() === "")) return [];
    const byKey: Record<string, CellValue> = {};
    for (const [key, at] of index) byKey[key] = cells[at] ?? null;
    return [{ row: i + 2, cells: byKey }];
  });
}

/** Cell → trimmed text ("" when blank); whole numbers without « .0 ». */
export function text(value: CellValue): string {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  return String(value).trim();
}

/** A phone typed in a number cell loses its leading 0 (661501234): it is given back. */
export function phone(value: CellValue): string {
  if (typeof value === "number") {
    const digits = String(Math.trunc(value));
    return /^[1-9]\d{8}$/.test(digits) ? `0${digits}` : digits;
  }
  return text(value);
}

/** Amount in dinars → the form's text ("1 250 000,50"), parsed by the zod builders. */
export function money(value: CellValue): string {
  if (typeof value === "number") return value.toFixed(2).replace(".", ",");
  return text(value);
}

/** Area in m² → "86,75". */
export function area(value: CellValue): string {
  if (typeof value === "number") return String(value).replace(".", ",");
  return text(value);
}

/** Date cell or « jj/mm/aaaa » / « aaaa-mm-jj » text → "YYYY-MM-DD"; "" when blank, null when unreadable. */
export function date(value: CellValue): string | null {
  if (value === null || text(value) === "") return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const raw = text(value);
  const french = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  const [y, m, d] = french
    ? [french[3], french[2], french[1]]
    : iso
      ? [iso[1], iso[2], iso[3]]
      : [];
  if (!y || !m || !d) return null;
  const day = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const check = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === day ? day : null;
}

const YES = new Set(["oui", "o", "yes", "y", "x", "1", "vrai", "true", "نعم"]);
const NO = new Set(["non", "n", "no", "0", "faux", "false", "لا", ""]);

/** Yes / no cell; null when unreadable. */
export function yesNo(value: CellValue): boolean | null {
  if (typeof value === "boolean") return value;
  const v = normalize(text(value));
  if (YES.has(v)) return true;
  if (NO.has(v)) return false;
  return null;
}

type Catalog = Record<string, unknown>;
const lookup = (catalog: Catalog, path: string): Record<string, string> => {
  let node: unknown = catalog;
  for (const part of path.split(".")) node = (node as Catalog | undefined)?.[part];
  return (node ?? {}) as Record<string, string>;
};

/**
 * An enum value from a cell: its code, or its label in French or Arabic (from the message
 * catalogs, e.g. `inventory.unitType`), or one of the extra synonyms; null when unknown.
 */
export function choice<T extends string>(
  value: CellValue,
  values: readonly T[],
  labels: string,
  synonyms: Record<string, T> = {},
): T | null {
  const v = normalize(text(value));
  if (v === "") return null;
  const frLabels = lookup(fr, labels);
  const arLabels = lookup(ar, labels);
  for (const code of values) {
    if (
      v === normalize(code) ||
      v === normalize(frLabels[code] ?? "") ||
      v === normalize(arLabels[code] ?? "")
    ) {
      return code;
    }
  }
  for (const [synonym, code] of Object.entries(synonyms)) {
    if (v === normalize(synonym)) return code;
  }
  return null;
}
