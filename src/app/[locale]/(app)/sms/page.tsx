import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { Pagination } from "@/components/data-table/pagination";
import {
  RemoveSmsOptOutButton,
  SmsLogFilters,
  SmsOptOutDialog,
  SmsStatusBadge,
} from "@/components/sms/sms-ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ERASED_RECIPIENT } from "@/lib/privacy";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listSmsMessages, SMS_LOG_PAGE_SIZE } from "@/server/sms/queries";
import { smsLogParams } from "@/server/sms/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sms");
  return { title: t("title") };
}

const refHref = (type: string | null, id: string | null) =>
  !id
    ? null
    : type === "reservation"
      ? `/sales/${id}`
      : type === "lease"
        ? `/rentals/${id}`
        : type === "residence"
          ? `/residences/${id}`
          : null;

/** The SMS sent (CLAUDE.md §7 SMS), latest first, and the numbers that asked for none. */
export default async function SmsLogPage({ params, searchParams }: PageProps<"/[locale]/sms">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("notification:read");
  const query = await searchParams;
  const value = (key: string) => (typeof query[key] === "string" ? query[key] : undefined);
  const filters = smsLogParams.parse({
    status: value("status"),
    kind: value("kind"),
    page: value("page"),
  });
  const { rows, total, page, optOuts } = await listSmsMessages(ctx, filters);
  const t = await getTranslations("sms");
  const tw = await getTranslations("whatsapp");
  const editable = can(ctx.roles, "notification:update");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <SmsLogFilters />
      <p className="text-sm text-muted-foreground">{t("count", { count: total })}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="sms-messages">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.recipient")}</TableHead>
                <TableHead>{t("columns.text")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.record")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => {
                const href = refHref(m.refType, m.refId);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(m.createdAt)}
                      <div className="text-xs text-muted-foreground">
                        {m.kind ? tw(`kind.${m.kind}`) : t("testMessage")}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {m.recipientName}
                      <div className="text-xs text-muted-foreground">
                        {m.recipient === ERASED_RECIPIENT ? "—" : <PhoneText value={m.recipient} />}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal">
                      <bdi className="text-sm">{m.text}</bdi>
                      <div className="text-xs text-muted-foreground">
                        {t("segments", { count: m.segments })}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <SmsStatusBadge status={m.status} />
                      {m.error ? <div className="mt-1 text-xs text-red-800">{m.error}</div> : null}
                    </TableCell>
                    <TableCell>
                      {href ? (
                        <Link href={href} className="text-sm hover:underline">
                          {tw(`ref.${m.refType as "reservation" | "lease" | "residence"}`)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        pathname="/sms"
        params={{ status: filters.status, kind: filters.kind }}
        page={page}
        pageSize={SMS_LOG_PAGE_SIZE}
        total={total}
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">{t("optOut.cardTitle")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("optOut.cardDescription")}</p>
          </div>
          {editable ? <SmsOptOutDialog /> : null}
        </CardHeader>
        <CardContent>
          {optOuts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("optOut.empty")}</p>
          ) : (
            <ul className="divide-y text-sm" data-testid="sms-opt-outs">
              {optOuts.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <PhoneText value={o.phone} />
                    <div className="text-xs text-muted-foreground">
                      {[o.reason, o.createdByName, formatDateTime(o.createdAt)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  {editable ? <RemoveSmsOptOutButton optOutId={o.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
