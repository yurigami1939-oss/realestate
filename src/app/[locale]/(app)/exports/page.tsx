import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ChoiceExport, CollectionsExport, PlainExport } from "@/components/exports/export-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { can, type Permission } from "@/lib/permissions";
import { requireTenantCtx } from "@/server/auth/page-guard";
import type { ExportKind } from "@/server/exports/schemas";
import { listProjectOptions } from "@/server/inventory/queries";
import { listResidences } from "@/server/residences/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("exports.page");
  return { title: t("title") };
}

/**
 * Spreadsheet exports (CLAUDE.md §5 Exports): the accountant's journal of collections over a
 * period, then the lists — each shown to the members who may read it.
 */
export default async function ExportsPage({ params }: PageProps<"/[locale]/exports">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requireTenantCtx();
  const t = await getTranslations("exports.page");
  const allowed = (permission: Permission) => can(ctx.roles, permission);
  const today = todayInAlgiers();
  const projects = allowed("inventory:read") ? await listProjectOptions(ctx) : [];
  const residences = allowed("residence:read") ? await listResidences(ctx) : [];
  const residenceChoices = residences.map((r) => ({ id: r.id, name: r.name }));

  const sections: ({ key: ExportKind; control: React.ReactNode } | false)[] = [
    allowed("payment:read") && {
      key: "collections",
      control: <CollectionsExport from={`${today.slice(0, 7)}-01`} to={today} />,
    },
    allowed("sale:read") && { key: "sales", control: <PlainExport kind="sales" /> },
    allowed("sale:read") && { key: "installments", control: <PlainExport kind="installments" /> },
    allowed("inventory:read") && {
      key: "units",
      control: (
        <ChoiceExport
          kind="units"
          param="project"
          label={t("project")}
          allLabel={t("allProjects")}
          choices={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      ),
    },
    allowed("lead:read") && { key: "leads", control: <PlainExport kind="leads" /> },
    allowed("buyer:read") && { key: "buyers", control: <PlainExport kind="buyers" /> },
    allowed("charge:read") &&
      residenceChoices.length > 0 && {
        key: "charges",
        control: (
          <ChoiceExport
            kind="charges"
            param="residence"
            label={t("residence")}
            choices={residenceChoices}
          />
        ),
      },
    allowed("lease:read") && { key: "leases", control: <PlainExport kind="leases" /> },
    allowed("supplier:read") && {
      key: "invoices",
      control: (
        <ChoiceExport
          kind="invoices"
          param="residence"
          label={t("residence")}
          allLabel={t("allResidences")}
          choices={residenceChoices}
        />
      ),
    },
  ];
  const shown = sections.filter((section) => section !== false);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {shown.map((section) => (
            <Card key={section.key} data-testid={`export-card-${section.key}`}>
              <CardHeader>
                <CardTitle className="text-base">{t(`${section.key}.title`)}</CardTitle>
                <p className="text-sm text-muted-foreground">{t(`${section.key}.description`)}</p>
              </CardHeader>
              <CardContent>{section.control}</CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
