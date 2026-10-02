import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { CompleteFollowUpDialog } from "@/components/crm/activity-dialogs";
import { LeadStageBadge } from "@/components/crm/badges";
import { PhoneText } from "@/components/crm/phone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { phoneHref } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/auth/page-guard";
import { listLeadOwners, listOpenFollowUps } from "@/server/crm/queries";

import { AssigneeFilter } from "../leads/pipeline/_components/assignee-filter";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("crm.followUps");
  return { title: t("title") };
}

type FollowUp = Awaited<ReturnType<typeof listOpenFollowUps>>[number];

export default async function FollowUpsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/follow-ups">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("lead:read");
  const raw = (await searchParams).assignee;
  const managers = can(ctx.roles, "lead:read_all");
  const followUps = await listOpenFollowUps(ctx, {
    assignee: typeof raw === "string" ? raw : undefined,
  });
  const owners = managers ? await listLeadOwners(ctx) : null;
  const t = await getTranslations("crm.followUps");

  const groups = [
    { key: "overdue", items: followUps.filter((f) => f.overdue) },
    { key: "today", items: followUps.filter((f) => !f.overdue && f.dueToday) },
    { key: "upcoming", items: followUps.filter((f) => !f.overdue && !f.dueToday) },
  ] as const;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={owners ? <AssigneeFilter owners={owners} /> : null}
      />
      {followUps.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <Card key={g.key} data-testid={`follow-ups-${g.key}`}>
              <CardHeader>
                <CardTitle className={cn("text-base", g.key === "overdue" && "text-rose-700")}>
                  {t(g.key)} · {g.items.length}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {g.items.map((f) => (
                    <FollowUpRow key={f.id} followUp={f} showAssignee={managers} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))
      )}
    </div>
  );
}

function FollowUpRow({ followUp: f, showAssignee }: { followUp: FollowUp; showAssignee: boolean }) {
  const t = useTranslations("crm");
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 space-y-1 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium whitespace-nowrap">{formatDateTime(f.dueAt)}</span>
          <span className="text-muted-foreground">{t(`channel.${f.channel}`)}</span>
          {showAssignee && f.assigneeName ? (
            <span className="text-muted-foreground">· {f.assigneeName}</span>
          ) : null}
        </p>
        <p className="flex flex-wrap items-center gap-2">
          <Link href={`/leads/${f.leadId}`} className="font-medium hover:underline">
            {f.leadName}
          </Link>
          <a href={phoneHref(f.leadPhone)} className="text-muted-foreground hover:underline">
            <PhoneText value={f.leadPhone} />
          </a>
          <LeadStageBadge stage={f.leadStage} />
        </p>
        {f.note ? <p className="text-muted-foreground">{f.note}</p> : null}
      </div>
      <CompleteFollowUpDialog followUpId={f.id} />
    </li>
  );
}
