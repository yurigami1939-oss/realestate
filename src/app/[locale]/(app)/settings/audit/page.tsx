import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Pagination } from "@/components/data-table/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDateTime } from "@/lib/dates";
import { requirePermission } from "@/server/auth/page-guard";
import { listAuditActors, listAuditLog } from "@/server/audit/queries";
import { auditEntityTypes, auditListParams } from "@/server/audit/schemas";

import { AuditFilters } from "./_components/audit-filters";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("audit");
  return { title: t("title") };
}

/** A before/after snapshot as stored (amounts are decimal strings of centimes). */
function Snapshot({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <pre
        dir="ltr"
        className="max-h-60 overflow-auto rounded-md bg-muted p-2 text-start text-xs whitespace-pre-wrap"
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default async function AuditPage({
  params,
  searchParams,
}: PageProps<"/[locale]/settings/audit">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("audit:read");
  const raw = await searchParams;
  const value = (key: string) => (typeof raw[key] === "string" ? raw[key] : undefined);
  const filters = auditListParams.parse({
    entityType: value("entityType"),
    entityId: value("entityId"),
    actorUserId: value("actorUserId"),
    from: value("from"),
    to: value("to"),
    page: value("page"),
  });
  const result = await listAuditLog(ctx, filters);
  const actors = await listAuditActors(ctx);
  const t = await getTranslations("audit");
  const actionLabel = (action: string) => {
    const key = `actions.${action}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : action;
  };
  const entityLabel = (type: string) =>
    (auditEntityTypes as readonly string[]).includes(type)
      ? t(`entities.${type as (typeof auditEntityTypes)[number]}`)
      : type;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <AuditFilters actors={actors} />
      <p className="text-sm text-muted-foreground">{t("count", { count: result.total })}</p>
      {result.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="audit-log">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.actor")}</TableHead>
                <TableHead>{t("columns.action")}</TableHead>
                <TableHead>{t("columns.record")}</TableHead>
                <TableHead>{t("columns.details")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.id} className="align-top" data-action={row.action}>
                  <TableCell className="tabular-nums" dir="ltr">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>{row.actorName ?? t("system")}</TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{actionLabel(row.action)}</span>
                    {row.reason ? (
                      <span className="block text-xs whitespace-pre-line text-muted-foreground">
                        {t("reason", { reason: row.reason })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {row.href ? (
                      <Link href={row.href} className="hover:underline">
                        {entityLabel(row.entityType)}
                      </Link>
                    ) : (
                      entityLabel(row.entityType)
                    )}
                    <Link
                      href={{
                        pathname: "/settings/audit",
                        query: { entityType: row.entityType, entityId: row.entityId },
                      }}
                      className="block text-xs text-muted-foreground hover:underline"
                    >
                      {t("history")}
                    </Link>
                  </TableCell>
                  <TableCell className="min-w-72 whitespace-normal">
                    {row.before !== null || row.after !== null ? (
                      <details>
                        <summary className="cursor-pointer text-sm text-muted-foreground">
                          {t("showDetails")}
                        </summary>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <Snapshot label={t("before")} value={row.before} />
                          <Snapshot label={t("after")} value={row.after} />
                        </div>
                      </details>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        pathname="/settings/audit"
        params={{
          entityType: filters.entityType,
          entityId: filters.entityId,
          actorUserId: filters.actorUserId,
          from: filters.from,
          to: filters.to,
        }}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
    </div>
  );
}
