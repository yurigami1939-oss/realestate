import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { RecordVisitDialog } from "@/components/crm/activity-dialogs";
import { VisitStatusBadge } from "@/components/crm/badges";
import { PhoneText } from "@/components/crm/phone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import {
  formatDate,
  formatDateTime,
  fromAlgiersDateTime,
  toCalendarDate,
  todayInAlgiers,
} from "@/lib/dates";
import { requirePermission } from "@/server/auth/page-guard";
import { listVisits } from "@/server/crm/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("crm.visits");
  return { title: t("title") };
}

const DAYS = 14;

export default async function VisitsPage({ params }: PageProps<"/[locale]/visits">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("lead:read");
  const from = fromAlgiersDateTime(`${todayInAlgiers()}T00:00`) ?? new Date();
  const to = new Date(from.getTime() + DAYS * 24 * 3600 * 1000);
  const visits = await listVisits(ctx, { from, to });
  const t = await getTranslations("crm");

  const days = [...new Set(visits.map((v) => toCalendarDate(v.scheduledAt)))];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={t("visits.title")} description={t("visits.description")} />
      {visits.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("visits.empty")}
        </p>
      ) : (
        days.map((day) => (
          <Card key={day}>
            <CardHeader>
              <CardTitle className="text-base">{formatDate(day)}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {visits
                  .filter((v) => toCalendarDate(v.scheduledAt) === day)
                  .map((v) => (
                    <li
                      key={v.id}
                      className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {formatDateTime(v.scheduledAt).slice(11)}
                          </span>
                          <VisitStatusBadge status={v.status} />
                          <Link href={`/leads/${v.leadId}`} className="font-medium hover:underline">
                            {v.leadName}
                          </Link>
                          <span className="text-muted-foreground">
                            <PhoneText value={v.leadPhone} />
                          </span>
                        </p>
                        <p className="text-muted-foreground">
                          {[v.projectName, v.unitCode, v.agentName].filter(Boolean).join(" · ") ||
                            "—"}
                        </p>
                        {v.notes ? <p className="text-muted-foreground">{v.notes}</p> : null}
                      </div>
                      <RecordVisitDialog
                        visitId={v.id}
                        scheduledAt={v.scheduledAt}
                        status={v.status}
                        outcome={null}
                      />
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
