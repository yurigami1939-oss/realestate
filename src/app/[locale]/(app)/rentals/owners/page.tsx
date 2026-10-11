import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { OwnerDialog } from "@/components/mandates/mandate-dialogs";
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
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listOwners } from "@/server/mandates/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mandates");
  return { title: t("title") };
}

/** Owners whose units the organization lets under a management mandate (CLAUDE.md §7 Rentals). */
export default async function OwnersPage({ params }: PageProps<"/[locale]/rentals/owners">) {
  const { locale: raw } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("lease:read");
  const owners = await listOwners(ctx);
  const t = await getTranslations("mandates");
  const tr = await getTranslations("rentals");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        crumbs={[{ label: tr("title"), href: "/rentals" }]}
        actions={can(ctx.roles, "lease:update") ? <OwnerDialog /> : null}
      />
      {owners.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="owners">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.owner")}</TableHead>
                <TableHead>{t("columns.phone")}</TableHead>
                <TableHead className="text-end">{t("columns.mandates")}</TableHead>
                <TableHead className="text-end">{t("columns.unpaid")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link href={`/rentals/owners/${o.id}`} className="font-medium hover:underline">
                      {o.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <PhoneText value={o.phone} />
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{o.mandates}</TableCell>
                  <TableCell className="text-end">
                    {o.unpaid > 0n ? (
                      <bdi dir="ltr" className="font-medium tabular-nums">
                        {formatDZD(o.unpaid, locale)}
                      </bdi>
                    ) : (
                      "—"
                    )}
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
