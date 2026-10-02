import type { Metadata } from "next";
import { useLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { leadStageClasses } from "@/components/crm/badges";
import { PhoneText } from "@/components/crm/phone";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatCompactDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/auth/page-guard";
import { getPipeline, listLeadOwners } from "@/server/crm/queries";

import { AssigneeFilter } from "./_components/assignee-filter";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("crm.pipeline");
  return { title: t("title") };
}

type Pipeline = Awaited<ReturnType<typeof getPipeline>>;

export default async function PipelinePage({
  params,
  searchParams,
}: PageProps<"/[locale]/leads/pipeline">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("lead:read");
  const raw = (await searchParams).assignee;
  const assignee = typeof raw === "string" && raw !== "" ? raw : undefined;
  const managers = can(ctx.roles, "lead:read_all");
  const pipeline = await getPipeline(ctx, { assignee });
  const owners = managers ? await listLeadOwners(ctx) : null;
  const t = await getTranslations("crm");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pipeline.title")}
        description={t("pipeline.description")}
        crumbs={[{ label: t("leads.title"), href: "/leads" }]}
        actions={owners ? <AssigneeFilter owners={owners} /> : null}
      />
      <p className="text-sm text-muted-foreground">{t("pipeline.closed", pipeline.closed)}</p>
      <Board columns={pipeline.columns} />
    </div>
  );
}

function Board({ columns }: { columns: Pipeline["columns"] }) {
  const t = useTranslations("crm");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  return (
    <div className="flex gap-4 overflow-x-auto pb-4" data-testid="pipeline">
      {columns.map((column) => (
        <section
          key={column.stage}
          className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2"
          aria-label={t(`stage.${column.stage}`)}
        >
          <h2
            className={cn(
              "flex items-center justify-between rounded-md border px-2 py-1 text-sm font-semibold",
              leadStageClasses[column.stage],
            )}
          >
            {t(`stage.${column.stage}`)}
            <span className="tabular-nums">{column.total}</span>
          </h2>
          {column.cards.length === 0 ? (
            <p className="p-2 text-center text-xs text-muted-foreground">{t("pipeline.empty")}</p>
          ) : (
            column.cards.map((card) => (
              <Link
                key={card.id}
                href={`/leads/${card.id}`}
                className="space-y-1 rounded-md border bg-background p-2.5 text-sm shadow-xs transition-shadow hover:shadow-sm"
              >
                <p className="font-medium">{card.fullName}</p>
                <p className="text-xs text-muted-foreground">
                  <PhoneText value={card.phone} />
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    card.projectName,
                    card.typologies.join("/") || null,
                    card.budget !== null ? formatCompactDZD(card.budget, locale) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
                {card.assigneeName ? (
                  <p className="text-xs text-muted-foreground">{card.assigneeName}</p>
                ) : null}
              </Link>
            ))
          )}
          {column.total > column.cards.length ? (
            <Link
              href={{ pathname: "/leads", query: { stage: column.stage } }}
              className="p-1 text-center text-xs text-muted-foreground hover:underline"
            >
              {t("pipeline.more", { count: column.total - column.cards.length })}
            </Link>
          ) : null}
        </section>
      ))}
    </div>
  );
}
