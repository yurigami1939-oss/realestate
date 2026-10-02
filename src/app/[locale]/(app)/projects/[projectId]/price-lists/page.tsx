import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getProject, listPriceLists } from "@/server/inventory/queries";

import { NewPriceListDialog } from "./_components/new-price-list-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory.priceLists");
  return { title: t("title") };
}

export default async function PriceListsPage({
  params,
}: PageProps<"/[locale]/projects/[projectId]/price-lists">) {
  const { locale, projectId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("inventory:read");
  const [project, lists] = await Promise.all([
    getProject(ctx, projectId),
    listPriceLists(ctx, projectId),
  ]);
  if (!project) notFound();
  const t = await getTranslations("inventory");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t("priceLists.title")}
        description={t("priceLists.description")}
        crumbs={[
          { label: t("projects.title"), href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
        ]}
        actions={
          can(ctx.roles, "price:update") ? <NewPriceListDialog projectId={projectId} /> : null
        }
      />
      {lists.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("priceLists.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("priceLists.name")}</TableHead>
                <TableHead>{t("units.fields.status")}</TableHead>
                <TableHead>{t("stats.units")}</TableHead>
                <TableHead>{t("units.historyColumns.date")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/projects/${projectId}/price-lists/${l.id}`}
                      className="hover:underline"
                    >
                      <span dir="ltr">{t("priceLists.version", { version: l.version })}</span> ·{" "}
                      {l.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        l.status === "draft"
                          ? "outline"
                          : l.status === "applied"
                            ? "default"
                            : "secondary"
                      }
                    >
                      {t(`priceLists.status.${l.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>{t("priceLists.items", { count: l.items })}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(l.appliedAt ?? l.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
