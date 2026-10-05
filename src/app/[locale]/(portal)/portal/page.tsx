import { Building2, Home } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SaleStatusBadge } from "@/components/sales/badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate } from "@/lib/dates";
import { requirePortalCtx } from "@/server/portal/page-guard";
import { getPortalOverview } from "@/server/portal/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.shell");
  return { title: t("title") };
}

/** Portal home: the purchases and the units shown to this account. */
export default async function PortalHomePage({ params }: PageProps<"/[locale]/portal">) {
  const { locale } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePortalCtx();
  const { sales, units } = await getPortalOverview(ctx);
  const t = await getTranslations("portal.home");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("welcome", { name: ctx.name })}</h1>
      {sales.length === 0 && units.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : null}
      {sales.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 font-medium">
            <Home className="size-4" aria-hidden />
            {t("sales")}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="portal-sales">
            {sales.map((s) => (
              <li key={s.id}>
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-2">
                    <CardTitle className="text-base">
                      <Link href={`/portal/sales/${s.id}`} className="hover:underline">
                        {s.projectName} · <bdi dir="ltr">{s.unitCode}</bdi>
                      </Link>
                    </CardTitle>
                    <SaleStatusBadge status={s.status} />
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    <bdi dir="ltr">{s.number}</bdi> ·{" "}
                    {t("reservedOn", { date: formatDate(s.reservedOn) })}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {units.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 font-medium">
            <Building2 className="size-4" aria-hidden />
            {t("units")}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="portal-units">
            {units.map((u) => (
              <li key={u.residentId}>
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-2">
                    <CardTitle className="text-base">
                      {u.residenceName} · <bdi dir="ltr">{u.unitCode}</bdi>
                    </CardTitle>
                    <Badge variant="outline">{t(`kind.${u.kind}`)}</Badge>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
