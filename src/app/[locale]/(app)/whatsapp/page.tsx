import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { Pagination } from "@/components/data-table/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WhatsappLogFilters, WhatsappStatusBadge } from "@/components/whatsapp/whatsapp-ui";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDateTime } from "@/lib/dates";
import { requirePermission } from "@/server/auth/page-guard";
import { listWhatsappMessages, WHATSAPP_LOG_PAGE_SIZE } from "@/server/whatsapp/queries";
import { whatsappLogParams } from "@/server/whatsapp/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("whatsapp");
  return { title: t("title") };
}

const refHref = (type: string, id: string) =>
  type === "reservation"
    ? `/sales/${id}`
    : type === "lease"
      ? `/rentals/${id}`
      : type === "residence"
        ? `/residences/${id}`
        : null;

/** The WhatsApp messages sent (CLAUDE.md §7 WhatsApp), latest first, with Meta's status. */
export default async function WhatsappLogPage({
  params,
  searchParams,
}: PageProps<"/[locale]/whatsapp">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("notification:read");
  const query = await searchParams;
  const value = (key: string) => (typeof query[key] === "string" ? query[key] : undefined);
  const filters = whatsappLogParams.parse({
    status: value("status"),
    kind: value("kind"),
    page: value("page"),
  });
  const { rows, total, page } = await listWhatsappMessages(ctx, filters);
  const t = await getTranslations("whatsapp");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <WhatsappLogFilters />
      <p className="text-sm text-muted-foreground">{t("count", { count: total })}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="whatsapp-messages">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.recipient")}</TableHead>
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
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {t(`kind.${m.kind}`)}
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        {m.template} · {m.language}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {m.recipientName}
                      <div className="text-xs text-muted-foreground">
                        <PhoneText value={`+${m.recipient}`} />
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <WhatsappStatusBadge status={m.status} />
                      {m.error ? (
                        <div className="mt-1 text-xs text-red-800" dir="ltr">
                          {m.error}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {href ? (
                        <Link href={href} className="text-sm hover:underline">
                          {t(`ref.${m.refType as "reservation" | "lease" | "residence"}`)}
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
        pathname="/whatsapp"
        params={{ status: filters.status, kind: filters.kind }}
        page={page}
        pageSize={WHATSAPP_LOG_PAGE_SIZE}
        total={total}
      />
    </div>
  );
}
