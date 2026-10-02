import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { requirePermission } from "@/server/auth/page-guard";

import { ProjectForm } from "../_components/project-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory.projects");
  return { title: t("new") };
}

export default async function NewProjectPage({ params }: PageProps<"/[locale]/projects/new">) {
  setRequestLocale(toLocale((await params).locale));
  await requirePermission("project:create");
  const t = await getTranslations("inventory.projects");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("new")} crumbs={[{ label: t("title"), href: "/projects" }]} />
      <ProjectForm />
    </div>
  );
}
