import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnnounceVisitorDialog, CancelVisitorButton } from "@/components/visitors/visitor-dialogs";
import { toLocale } from "@/i18n/locales";
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { requirePortalCtx } from "@/server/portal/page-guard";
import { timeOf } from "@/server/rooms/service";
import { listPortalVisitors } from "@/server/visitors/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("visitors");
  return { title: t("portalTitle") };
}

/** A resident's visitors: announced with a code for the gate, then seen arriving. */
export default async function PortalVisitorsPage({
  params,
}: PageProps<"/[locale]/portal/visitors">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePortalCtx();
  const { units, passes } = await listPortalVisitors(ctx);
  const t = await getTranslations("visitors");
  const today = todayInAlgiers();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-large-title">{t("portalTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("portalDescription")}</p>
        </div>
        {units.length > 0 ? <AnnounceVisitorDialog units={units} today={today} /> : null}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("mine")}</CardTitle>
        </CardHeader>
        <CardContent>
          {passes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noneAnnounced")}</p>
          ) : (
            <ul className="divide-y text-sm" data-testid="my-visitors">
              {passes.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                  data-status={p.status}
                >
                  <div>
                    <div className="font-medium">
                      {p.visitorName}
                      {p.people > 1 ? ` (${p.people})` : ""} · {formatDate(p.expectedOn)}
                    </div>
                    {p.code && p.status === "expected" ? (
                      <div className="text-muted-foreground">
                        {t("codeLine")}{" "}
                        <bdi dir="ltr" className="font-mono font-semibold" data-testid="pass-code">
                          {p.code}
                        </bdi>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {p.status === "arrived" && p.arrivedAt
                        ? t("arrivedAt", { time: timeOf(p.arrivedAt) })
                        : t(`status.${p.status}`)}
                    </Badge>
                    {p.status === "expected" ? <CancelVisitorButton passId={p.id} /> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
