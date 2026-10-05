import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ImportPanel } from "@/components/imports/import-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { can, type Permission } from "@/lib/permissions";
import { requireTenantCtx } from "@/server/auth/page-guard";
import type { ImportKind } from "@/server/imports/schemas";
import { listProjectOptions } from "@/server/inventory/queries";
import { listResidences } from "@/server/residences/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("imports.page");
  return { title: t("title") };
}

/**
 * Data import (reprise, CLAUDE.md §7 Imports): units of a project, buyer files, ongoing sales
 * with their schedules and past payments, co-owners and shares of a residence — each shown to
 * the members who may create what it writes.
 */
export default async function ImportsPage({ params }: PageProps<"/[locale]/imports">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requireTenantCtx();
  const t = await getTranslations("imports");
  const allowed = (...permissions: Permission[]) => permissions.every((p) => can(ctx.roles, p));
  const projects = allowed("unit:create") ? await listProjectOptions(ctx) : [];
  const residences = allowed("residence:update") ? await listResidences(ctx) : [];

  const sections: ({ key: ImportKind; control: React.ReactNode } | false)[] = [
    allowed("unit:create") && {
      key: "units",
      control: (
        <ImportPanel
          kind="units"
          target={{
            param: "project",
            label: t("page.project"),
            choices: projects.map((p) => ({ id: p.id, name: `${p.code} · ${p.name}` })),
          }}
        />
      ),
    },
    allowed("buyer:create", "buyer:read_all") && {
      key: "buyers",
      control: <ImportPanel kind="buyers" />,
    },
    allowed("sale:create", "sale:sign", "payment:create", "buyer:read_all") && {
      key: "sales",
      control: <ImportPanel kind="sales" />,
    },
    allowed("residence:update") && {
      key: "residents",
      control: (
        <ImportPanel
          kind="residents"
          target={{
            param: "residence",
            label: t("page.residence"),
            choices: residences.map((r) => ({ id: r.id, name: r.name })),
          }}
        />
      ),
    },
  ];
  const shown = sections.filter((section) => section !== false);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={t("page.title")} description={t("page.description")} />
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("page.none")}</p>
      ) : (
        shown.map((section) => (
          <Card key={section.key}>
            <CardHeader>
              <CardTitle className="text-base">{t(`kinds.${section.key}.title`)}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t(`kinds.${section.key}.description`)}
              </p>
            </CardHeader>
            <CardContent>{section.control}</CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
