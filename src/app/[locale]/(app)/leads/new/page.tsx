import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listLeadOwners } from "@/server/crm/queries";
import { listProjectOptions } from "@/server/inventory/queries";

import { LeadForm } from "../_components/lead-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("crm.leads");
  return { title: t("new") };
}

export default async function NewLeadPage({ params }: PageProps<"/[locale]/leads/new">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("lead:create");
  const projects = await listProjectOptions(ctx);
  const owners = can(ctx.roles, "lead:assign") ? await listLeadOwners(ctx) : null;
  const t = await getTranslations("crm.leads");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t("new")} crumbs={[{ label: t("title"), href: "/leads" }]} />
      <LeadForm projects={projects} owners={owners} />
    </div>
  );
}
