import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { TicketPriorityBadge, TicketStatusBadge } from "@/components/tickets/ticket-badges";
import {
  AssignTicketDialog,
  CommentTicketDialog,
  TicketStatusDialog,
} from "@/components/tickets/ticket-dialogs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { ticketTransitions } from "@/lib/tickets";
import { requirePermission } from "@/server/auth/page-guard";
import { getTicket } from "@/server/tickets/queries";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/tickets/[ticketId]">): Promise<Metadata> {
  const ctx = await requirePermission("ticket:read");
  const found = await getTicket(ctx, (await params).ticketId);
  return { title: found?.title };
}

export default async function TicketPage({ params }: PageProps<"/[locale]/tickets/[ticketId]">) {
  const { locale, ticketId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("ticket:read");
  const ticket = await getTicket(ctx, ticketId);
  if (!ticket) notFound();
  const t = await getTranslations("tickets");
  const editable = can(ctx.roles, "ticket:update");
  const live = ticket.status !== "closed" && ticket.status !== "cancelled";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={ticket.title}
        description={[
          ticket.residenceName,
          ticket.unitCode ? t("unit", { code: ticket.unitCode }) : t("commonAreas"),
          t(`category.${ticket.category}`),
        ].join(" · ")}
        crumbs={[{ label: t("title"), href: "/tickets" }]}
        badge={<TicketStatusBadge status={ticket.status} />}
      />
      <dl className="grid gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("fields.priority")}</dt>
          <dd>
            <TicketPriorityBadge priority={ticket.priority} />
          </dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("columns.openedOn")}</dt>
          <dd className="font-medium">{formatDate(ticket.createdAt)}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("fields.reporterName")}</dt>
          <dd className="font-medium">{ticket.reporterName ?? "—"}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("columns.assignee")}</dt>
          <dd className="font-medium">{ticket.assignee ?? t("nobody")}</dd>
        </div>
      </dl>
      {editable && live ? (
        <div className="flex flex-wrap gap-2">
          {ticketTransitions[ticket.status].map((to) => (
            <TicketStatusDialog key={to} ticketId={ticket.id} to={to} />
          ))}
          <AssignTicketDialog
            ticketId={ticket.id}
            staffId={ticket.assignedStaffId}
            supplierId={ticket.assignedSupplierId}
            staff={ticket.staff}
            suppliers={ticket.suppliers}
          />
          <CommentTicketDialog ticketId={ticket.id} />
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("history")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm" data-testid="ticket-events">
            {ticket.events.map((e) => (
              <li key={e.id} className="border-s-2 ps-3">
                <div className="text-xs text-muted-foreground">
                  {formatDateTime(e.createdAt)} · {e.actorName ?? t("system")}
                </div>
                <div className="font-medium">
                  {e.kind === "created"
                    ? t("event.created")
                    : e.kind === "status" && e.toStatus
                      ? t("event.status", { status: t(`status.${e.toStatus}`) })
                      : e.kind === "assigned"
                        ? e.assignee
                          ? t("event.assigned", { name: e.assignee })
                          : t("event.unassigned")
                        : t("event.comment")}
                </div>
                {e.comment ? (
                  <p className="whitespace-pre-line text-muted-foreground">{e.comment}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
