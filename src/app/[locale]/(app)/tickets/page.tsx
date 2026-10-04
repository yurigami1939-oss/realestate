import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { TicketPriorityBadge, TicketStatusBadge } from "@/components/tickets/ticket-badges";
import { NewTicketDialog } from "@/components/tickets/ticket-dialogs";
import { TicketFilters } from "@/components/tickets/ticket-filters";
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
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import type { TicketStatus } from "@/lib/tickets";
import { requirePermission } from "@/server/auth/page-guard";
import { listTicketTargets, listTickets } from "@/server/tickets/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tickets");
  return { title: t("title") };
}

export default async function TicketsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/tickets">) {
  const { locale } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("ticket:read");
  const query = await searchParams;
  const residenceId = typeof query.residence === "string" ? query.residence : undefined;
  const rawStatus = typeof query.status === "string" ? query.status : "active";
  const status = rawStatus === "__all__" ? undefined : (rawStatus as TicketStatus | "active");
  const tickets = await listTickets(ctx, { residenceId, status });
  const canCreate = can(ctx.roles, "ticket:create");
  const targets = canCreate ? await listTicketTargets(ctx) : [];
  const t = await getTranslations("tickets");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canCreate && targets.length > 0 ? (
            <NewTicketDialog targets={targets} residenceId={residenceId} />
          ) : null
        }
      />
      <TicketFilters residences={targets.map((r) => ({ id: r.id, name: r.name }))} />
      {tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="tickets">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.title")}</TableHead>
                <TableHead>{t("columns.residence")}</TableHead>
                <TableHead>{t("columns.place")}</TableHead>
                <TableHead>{t("columns.priority")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.assignee")}</TableHead>
                <TableHead>{t("columns.openedOn")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((ticket) => (
                <TableRow key={ticket.id}>
                  <TableCell className="whitespace-normal">
                    <Link href={`/tickets/${ticket.id}`} className="font-medium hover:underline">
                      {ticket.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {t(`category.${ticket.category}`)}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">{ticket.residenceName}</TableCell>
                  <TableCell dir={ticket.unitCode ? "ltr" : undefined} className="text-start">
                    {ticket.unitCode ?? t("commonAreas")}
                  </TableCell>
                  <TableCell>
                    <TicketPriorityBadge priority={ticket.priority} />
                  </TableCell>
                  <TableCell>
                    <TicketStatusBadge status={ticket.status} />
                  </TableCell>
                  <TableCell className="whitespace-normal">{ticket.assignee ?? "—"}</TableCell>
                  <TableCell>{formatDate(ticket.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
