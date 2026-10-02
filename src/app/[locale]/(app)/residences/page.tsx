import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
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
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listResidences } from "@/server/residences/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("residences");
  return { title: t("title") };
}

export default async function ResidencesPage({ params }: PageProps<"/[locale]/residences">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("residence:read");
  const residences = await listResidences(ctx);
  const t = await getTranslations("residences");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can(ctx.roles, "residence:create") ? (
            <Button asChild>
              <Link href="/residences/new">
                <Plus data-icon="inline-start" />
                {t("new")}
              </Link>
            </Button>
          ) : null
        }
      />
      {residences.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="residences">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.project")}</TableHead>
                <TableHead className="text-end">{t("columns.units")}</TableHead>
                <TableHead className="text-end">{t("columns.shares")}</TableHead>
                <TableHead className="text-end">{t("columns.coOwners")}</TableHead>
                <TableHead>{t("columns.frequency")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {residences.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/residences/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell>{r.projectName}</TableCell>
                  <TableCell className="text-end tabular-nums">{r.units}</TableCell>
                  <TableCell
                    className={
                      r.shares === r.shareBasis
                        ? "text-end tabular-nums"
                        : "text-end text-amber-800 tabular-nums"
                    }
                    dir="ltr"
                  >
                    {r.shares} / {r.shareBasis}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {r.unitsWithCoOwner} / {r.units}
                  </TableCell>
                  <TableCell>{t(`frequency.${r.chargeFrequency}`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
