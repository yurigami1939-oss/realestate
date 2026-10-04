import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { SupplierDialog } from "@/components/suppliers/supplier-dialog";
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
import { listSuppliers } from "@/server/suppliers/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("suppliers");
  return { title: t("title") };
}

export default async function SuppliersPage({ params }: PageProps<"/[locale]/suppliers">) {
  const { locale } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("supplier:read");
  const suppliers = await listSuppliers(ctx);
  const t = await getTranslations("suppliers");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={can(ctx.roles, "supplier:update") ? <SupplierDialog /> : null}
      />
      {suppliers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="suppliers">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.activity")}</TableHead>
                <TableHead>{t("columns.contact")}</TableHead>
                <TableHead className="text-end">{t("columns.runningContracts")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/suppliers/${s.id}`} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-normal">{s.activity ?? "—"}</TableCell>
                  <TableCell>
                    {s.phone ? <PhoneText value={s.phone} /> : null}
                    {s.email ? (
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        {s.email}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{s.runningContracts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
