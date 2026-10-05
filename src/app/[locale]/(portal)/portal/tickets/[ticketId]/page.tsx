import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { TicketPriorityBadge, TicketStatusBadge } from "@/components/tickets/ticket-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDateTime } from "@/lib/dates";
import { requirePortalCtx } from "@/server/portal/page-guard";
import { getPortalTicket } from "@/server/portal/residences";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.shell.nav");
  return { title: t("tickets") };
}

/** A ticket of the account and how it is being handled (status and assignment). */
export default async function PortalTicketPage({
  params,
}: PageProps<"/[locale]/portal/tickets/[ticketId]">) {
  const { locale, ticketId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePortalCtx();
  const ticket = await getPortalTicket(ctx, ticketId);
  if (!ticket) notFound();
  const t = await getTranslations("portal.tickets");
  const tt = await getTranslations("tickets");

  return (
    <div className="space-y-4">
      <Link
        href="/portal/tickets"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("back")}
      </Link>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{ticket.title}</h1>
          <TicketStatusBadge status={ticket.status} />
          <TicketPriorityBadge priority={ticket.priority} />
        </div>
        <p className="text-sm text-muted-foreground">
          {[
            ticket.residenceName,
            ticket.unitCode ? tt("unit", { code: ticket.unitCode }) : tt("commonAreas"),
            tt(`category.${ticket.category}`),
          ].join(" · ")}
        </p>
      </div>
      {ticket.description ? (
        <p className="text-sm whitespace-pre-line">{ticket.description}</p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tt("history")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm" data-testid="portal-ticket-events">
            {ticket.events.map((e) => (
              <li key={e.id} className="border-s-2 ps-3">
                <div className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</div>
                <div className="font-medium">
                  {e.kind === "created"
                    ? tt("event.created")
                    : e.kind === "status" && e.toStatus
                      ? tt("event.status", { status: tt(`status.${e.toStatus}`) })
                      : e.assignee
                        ? tt("event.assigned", { name: e.assignee })
                        : tt("event.unassigned")}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
