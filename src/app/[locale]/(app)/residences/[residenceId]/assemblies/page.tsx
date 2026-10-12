import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { AssemblyDialog } from "@/components/assemblies/assembly-dialogs";
import { AssemblyStatusBadge } from "@/components/assemblies/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { accessOf, can } from "@/lib/permissions";
import { listAssemblies } from "@/server/assemblies/queries";
import { requirePermission } from "@/server/auth/page-guard";
import { getResidence } from "@/server/residences/queries";

import { ResidenceNav } from "../_components/residence-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assemblies");
  return { title: t("title") };
}

export default async function ResidenceAssembliesPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/assemblies">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("assembly:read");
  const home = await getResidence(ctx, residenceId);
  if (!home) notFound();
  const assemblies = await listAssemblies(ctx, residenceId);
  const t = await getTranslations("assemblies");
  const tr = await getTranslations("residences");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={home.name}
        description={home.projectName}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
      />
      <ResidenceNav residenceId={residenceId} current="assemblies" roles={accessOf(ctx)} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle>{t("title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </div>
          {can(ctx, "assembly:update") ? (
            <AssemblyDialog residenceId={residenceId} today={todayInAlgiers()} />
          ) : null}
        </CardHeader>
        <CardContent>
          {assemblies.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl bg-card shadow-card in-data-[slot=card]:border in-data-[slot=card]:shadow-none">
              <Table stack data-testid="assemblies">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.date")}</TableHead>
                    <TableHead>{t("columns.kind")}</TableHead>
                    <TableHead>{t("columns.place")}</TableHead>
                    <TableHead>{t("columns.agenda")}</TableHead>
                    <TableHead>{t("columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assemblies.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link
                          data-row-link
                          href={`/residences/${residenceId}/assemblies/${a.id}`}
                          className="font-medium hover:underline"
                        >
                          {formatDate(a.heldOn)}
                        </Link>
                        <span className="text-muted-foreground" dir="ltr">
                          {" "}
                          {a.startTime}
                        </span>
                      </TableCell>
                      <TableCell>{t(`kindLabel.${a.kind}`)}</TableCell>
                      <TableCell className="whitespace-normal">{a.place}</TableCell>
                      <TableCell>
                        {a.status === "closed"
                          ? t("adoptedCount", { adopted: a.adopted, count: a.resolutions })
                          : t("resolutionsCount", { count: a.resolutions })}
                      </TableCell>
                      <TableCell>
                        <AssemblyStatusBadge status={a.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
