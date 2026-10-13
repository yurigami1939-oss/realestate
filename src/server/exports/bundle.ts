import "server-only";

import { strToU8, zipSync } from "fflate";
import { and, asc, eq, isNull } from "drizzle-orm";

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

/** The whole history: exports over a period start here. */
const SINCE = "2000-01-01";

/** A CSV cell (semicolons, quotes and line breaks quoted). */
const cell = (value: string | number | null) => {
  const text = value === null ? "" : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Everything the organization may take with it (CLAUDE.console.md §17 step 10; the gérant,
 * `organization:update`): one zip of every export it is entitled to — the lists and journals
 * over its whole history, each residence's accounts, each treasury account's ledger — and an
 * index of its stored files (name, record, type, size, date, download path; the files stay
 * downloadable one by one). Served in every state, read-only included; audited
 * `organization.export_bundle` besides each export's own row.
 */
export async function buildExportBundle(
  ctx: TenantCtx,
  locale: Locale,
  t: Translate,
): Promise<{ file: string; bytes: Uint8Array }> {
  assertCan(ctx, "organization:update");
  const today = todayInAlgiers();
  const { slug, residences, accounts, files } = await withTenant(ctx, async (tx) => {
    // Better Auth's table (no RLS): this organization's row only.
    const [org] = await tx
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, ctx.orgId));
    return {
      slug: org?.slug ?? "organisation",
      residences: await tx
        .select({ id: residence.id })
        .from(residence)
        .where(isNull(residence.deletedAt))
        .orderBy(asc(residence.createdAt)),
      accounts: await tx
        .select({ id: treasuryAccount.id })
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
        .where(and(isNull(file.deletedAt)))
        .orderBy(asc(file.createdAt)),
    };
  });

  const wanted: { kind: ExportKind; query: Record<string, string> }[] = [
    { kind: "collections", query: { from: SINCE, to: today } },
    { kind: "sales", query: {} },
    { kind: "installments", query: {} },
    { kind: "units", query: {} },
    { kind: "leads", query: {} },
    { kind: "buyers", query: {} },
    { kind: "leases", query: { status: "all" } },
    { kind: "invoices", query: {} },
    { kind: "report", query: { from: SINCE, to: today } },
    { kind: "accounting", query: { from: SINCE, to: today } },
    { kind: "rent_taxes", query: { year: today.slice(0, 4) } },
    ...residences.map((r) => ({ kind: "charges" as const, query: { residence: r.id } })),
    ...accounts.map((a) => ({
      kind: "ledger" as const,
      query: { account: a.id, from: SINCE, to: today },
    })),
  ];
  const entries: Record<string, Uint8Array> = {};
  const included: string[] = [];
  for (const [index, { kind, query }] of wanted.entries()) {
    try {
      const built = await buildExport(ctx, kind, query, locale, t);
      const name = `exports/${String(index + 1).padStart(2, "0")}-${built.file}`;
      entries[name] = new Uint8Array(built.bytes);
      included.push(kind);
    } catch (error) {
      // A module the organization does not have, or a list its gérant may not read: left out.
      if (
        !(error instanceof AppError) ||
        (error.code !== "FORBIDDEN" && error.code !== "VALIDATION")
      ) {
        throw error;
      }
    }
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
      after: { exports: included, files: files.length },
    }),
  );
  return { file: `${slug}-export-${today}.zip`, bytes: zipSync(entries, { level: 6 }) };
}
