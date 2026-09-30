import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { LeadStageBadge } from "@/components/crm/badges";
import { PhoneText } from "@/components/crm/phone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDateTime } from "@/lib/dates";
import { requirePermission } from "@/server/auth/page-guard";
import { listDuplicateGroups } from "@/server/crm/queries";

import { KeepLeadButton } from "./_components/keep-lead-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("crm.duplicates");
  return { title: t("title") };
}

export default async function DuplicatesPage({ params }: PageProps<"/[locale]/leads/duplicates">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("lead:merge");
  const groups = await listDuplicateGroups(ctx);
  const t = await getTranslations("crm");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t("duplicates.title")}
        description={t("duplicates.description")}
        crumbs={[{ label: t("leads.title"), href: "/leads" }]}
      />
      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("duplicates.empty")}
        </p>
      ) : (
        groups.map((group) => (
          <Card key={group.phone} data-testid="duplicate-group">
            <CardHeader>
              <CardTitle className="text-base">
                <PhoneText value={group.phone} />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {group.leads.map((lead) => (
                  <li
                    key={lead.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <div className="space-y-0.5">
                      <p className="flex flex-wrap items-center gap-2">
                        <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                          {lead.fullName}
                        </Link>
                        <LeadStageBadge stage={lead.stage} />
                      </p>
                      <p className="text-muted-foreground">
                        {[
                          t(`source.${lead.source}`),
                          lead.assigneeName ?? t("leads.unassigned"),
                          formatDateTime(lead.createdAt),
                        ].join(" · ")}
                      </p>
                    </div>
                    <KeepLeadButton
                      targetId={lead.id}
                      name={lead.fullName}
                      sourceIds={group.leads.filter((l) => l.id !== lead.id).map((l) => l.id)}
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
