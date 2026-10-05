import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PortalTicketDialog } from "@/components/portal/portal-ticket-dialog";
import { TicketPriorityBadge, TicketStatusBadge } from "@/components/tickets/ticket-badges";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate } from "@/lib/dates";
import { requirePortalCtx } from "@/server/portal/page-guard";
import { listPortalTickets, listPortalTicketTargets } from "@/server/portal/residences";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.shell.nav");
  return { title: t("tickets") };
}

/** The account's tickets (reported by it or on its units), active ones first. */
export default async function PortalTicketsPage({ params }: PageProps<"/[locale]/portal/tickets">) {
  const { locale } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePortalCtx();
  const tickets = await listPortalTickets(ctx);
  const targets = await listPortalTicketTargets(ctx);
  const t = await getTranslations("portal.tickets");
  const tt = await getTranslations("tickets");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {targets.length > 0 ? <PortalTicketDialog targets={targets} /> : null}
      </div>
      {tickets.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="portal-tickets">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="rounded-lg border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/portal/tickets/${ticket.id}`} className="font-medium hover:underline">
                  {ticket.title}
                </Link>
                <div className="flex gap-1">
                  <TicketPriorityBadge priority={ticket.priority} />
                  <TicketStatusBadge status={ticket.status} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {[
                  ticket.residenceName,
                  ticket.unitCode ? tt("unit", { code: ticket.unitCode }) : tt("commonAreas"),
                  tt(`category.${ticket.category}`),
                  formatDate(ticket.createdAt),
                ].join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
