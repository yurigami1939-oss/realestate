import "server-only";

import { strToU8, zipSync } from "fflate";
import { asc, eq, isNull, sql } from "drizzle-orm";

import { file, organization, residence, treasuryAccount } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { Locale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type { Translate } from "./builders";
import type { ExportKind } from "./schemas";
import { buildExport } from "./service";
import { MAX_EXPORT_ROWS } from "./xlsx";

/** The whole history: exports over a period start here. */
const SINCE = "2000-01-01";

/**
 * A CSV cell: semicolons, quotes and line breaks quoted; a value a spreadsheet would read as a
 * formula (a file name starting with =, +, -, @) kept as text.
 */
const cell = (value: string | number | null) => {
  const raw = value === null ? "" : String(value);
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The calendar years a journal is cut into, each under the export's row cap: from the year of the
 * organization's first money flow (never before SINCE's; the first file also takes anything
 * earlier) to `lastDay`'s year.
 */
export function yearsOf(firstYear: number, lastDay: string): { from: string; to: string }[] {
  const last = Number(lastDay.slice(0, 4));
  const first = Math.min(Math.max(firstYear, Number(SINCE.slice(0, 4))), last);
  const years: { from: string; to: string }[] = [];
  for (let year = first; year <= last; year += 1) {
    years.push({
      from: year === first ? SINCE : `${year}-01-01`,
      to: year === last ? lastDay : `${year}-12-31`,
    });
  }
  return years;
}

/**
 * Everything the organization may take with it (CLAUDE.console.md §17 step 10; the gérant,
 * `organization:update`): one zip of every export it is entitled to — modules switched off
 * included — the lists, the journals over its whole history (one file per year), each
 * residence's accounts, each treasury account's ledger (per year) — and an index of its stored
 * files (name, record, type, size, date, download path; the files stay downloadable one by one).
 * An export beyond the row cap is named in `manquants.txt`. Served in every state, read-only
 * included; audited `organization.export_bundle` besides each export's own row.
 */
export async function buildExportBundle(
  ctx: TenantCtx,
  locale: Locale,
  t: Translate,
): Promise<{ file: string; bytes: Uint8Array }> {
  assertCan(ctx, "organization:update");
  const today = todayInAlgiers();
  const { slug, firstYear, residences, accounts, files } = await withTenant(ctx, async (tx) => {
    // Better Auth's table (no RLS): this organization's row only.
    const [org] = await tx
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, ctx.orgId));
    // The first money flow (imported history included): where the yearly journals start.
    const { rows: first } = await tx.execute<{ year: number | null }>(sql`
      select extract(year from least(
        (select min(reserved_on) from reservation),
        (select min(paid_on) from payment),
        (select min(paid_on) from charge_payment),
        (select min(paid_on) from rent_payment),
        (select min(moved_on) from treasury_movement),
        (select min(opening_on) from treasury_account)
      ))::int as year`);
    return {
      slug: org?.slug ?? "organisation",
      firstYear: first[0]?.year ?? Number(today.slice(0, 4)),
      residences: await tx
        .select({ id: residence.id })
        .from(residence)
        .where(isNull(residence.deletedAt))
        .orderBy(asc(residence.createdAt)),
      accounts: await tx
        .select({
          id: treasuryAccount.id,
          openingOn: treasuryAccount.openingOn,
          closedOn: treasuryAccount.closedOn,
        })
        .from(treasuryAccount)
        .orderBy(asc(treasuryAccount.createdAt)),
      files: await tx
        .select({
          id: file.id,
          fileName: file.fileName,
          entityType: file.entityType,
          entityId: file.entityId,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          createdAt: file.createdAt,
        })
        .from(file)
        .where(isNull(file.deletedAt))
        .orderBy(asc(file.createdAt)),
    };
  });

  const years = yearsOf(firstYear, today);
  const wanted: { kind: ExportKind; query: Record<string, string> }[] = [
    ...years.map((period) => ({ kind: "collections" as const, query: period })),
    { kind: "sales", query: {} },
    { kind: "installments", query: {} },
    { kind: "units", query: {} },
    { kind: "leads", query: {} },
    { kind: "buyers", query: {} },
    { kind: "leases", query: { status: "all" } },
    { kind: "invoices", query: {} },
    { kind: "report", query: { from: SINCE, to: today } },
    ...years.map((period) => ({ kind: "accounting" as const, query: period })),
    { kind: "rent_taxes", query: { year: today.slice(0, 4) } },
    ...residences.map((r) => ({ kind: "charges" as const, query: { residence: r.id } })),
    // Each account's ledger over the years it was open.
    ...accounts.flatMap((a) =>
      yearsOf(Number(a.openingOn.slice(0, 4)), a.closedOn ?? today).map((period) => ({
        kind: "ledger" as const,
        query: { account: a.id, ...period },
      })),
    ),
  ];
  // What the organization is entitled to, including the modules its gérant switched off: its
  // data is its own whatever the switches say.
  const exportCtx: TenantCtx = ctx.access
    ? { ...ctx, access: { ...ctx.access, modules: ctx.access.entitled } }
    : ctx;
  const entries: Record<string, Uint8Array> = {};
  const included: string[] = [];
  const tooLarge: string[] = [];
  const digits = String(wanted.length).length;
  for (const [index, { kind, query }] of wanted.entries()) {
    try {
      const built = await buildExport(exportCtx, kind, query, locale, t);
      const name = `exports/${String(index + 1).padStart(Math.max(2, digits), "0")}-${built.file}`;
      entries[name] = new Uint8Array(built.bytes);
      included.push(kind);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      // Beyond the row cap: named in manquants.txt, to export by period from its list.
      if (error.code === "CONFLICT" && error.messageKey === "exports.errors.tooMany") {
        tooLarge.push([kind, ...Object.values(query)].join(" "));
        continue;
      }
      // A module the organization is not entitled to, or a list its gérant may not read.
      if (error.code !== "FORBIDDEN" && error.code !== "VALIDATION") throw error;
    }
  }
  if (tooLarge.length > 0) {
    entries["manquants.txt"] = strToU8(
      `\ufeff${t("exports.bundle.tooLarge", { max: MAX_EXPORT_ROWS })}\r\n\r\n${tooLarge.join("\r\n")}\r\n`,
    );
  }
  const index = [
    [
      "id",
      "file_name",
      "entity_type",
      "entity_id",
      "content_type",
      "size_bytes",
      "uploaded_at",
      "download",
    ],
    ...files.map((f) => [
      f.id,
      f.fileName,
      f.entityType,
      f.entityId,
      f.contentType,
      f.sizeBytes,
      f.createdAt.toISOString(),
      `/api/files/${f.id}?download`,
    ]),
  ]
    .map((row) => row.map(cell).join(";"))
    .join("\r\n");
  entries["fichiers.csv"] = strToU8(`\ufeff${index}\r\n`);

  await withTenant(ctx, (tx) =>
    recordAudit(tx, ctx, {
      actorUserId: ctx.access?.supportBy?.id ?? ctx.userId,
      action: "organization.export_bundle",
      entityType: "organization",
      entityId: ctx.orgId,
      after: { exports: included, tooLarge, files: files.length },
    }),
  );
  return { file: `${slug}-export-${today}.zip`, bytes: zipSync(entries, { level: 6 }) };
}
