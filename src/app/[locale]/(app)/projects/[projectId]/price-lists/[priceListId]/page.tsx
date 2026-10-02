import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import { toLocale } from "@/i18n/locales";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getPriceList } from "@/server/inventory/queries";

import { PriceListEditor } from "./_components/price-list-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory.priceLists");
  return { title: t("title") };
}

export default async function PriceListPage({
  params,
}: PageProps<"/[locale]/projects/[projectId]/price-lists/[priceListId]">) {
  const { locale, projectId, priceListId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("inventory:read");
  const list = await getPriceList(ctx, priceListId);
  if (!list || list.projectId !== projectId) notFound();
  const t = await getTranslations("inventory");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={`${t("priceLists.version", { version: list.version })} · ${list.name}`}
        badge={
          <Badge variant={list.status === "draft" ? "outline" : "secondary"}>
            {t(`priceLists.status.${list.status}`)}
          </Badge>
        }
        crumbs={[
          { label: t("projects.title"), href: "/projects" },
          { label: list.projectName, href: `/projects/${projectId}` },
          { label: t("priceLists.title"), href: `/projects/${projectId}/price-lists` },
        ]}
      />
      <PriceListEditor
        list={list}
        editable={list.status === "draft" && can(ctx.roles, "price:update")}
      />
    </div>
  );
}
