import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AssemblyStatusBadge, ResolutionResultBadge } from "@/components/assemblies/badges";
import { PortalDocument } from "@/components/portal/portal-document";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { formatDate } from "@/lib/dates";
import { requirePortalCtx } from "@/server/portal/page-guard";
import { listPortalAssemblies } from "@/server/portal/residences";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.shell.nav");
  return { title: t("assemblies") };
}

/** General assemblies of the co-owned residences: convocations, agendas, results and PVs. */
export default async function PortalAssembliesPage({
  params,
}: PageProps<"/[locale]/portal/assemblies">) {
  const { locale } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePortalCtx();
  const assemblies = await listPortalAssemblies(ctx);
  const t = await getTranslations("portal.assemblies");
  const ta = await getTranslations("assemblies");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {assemblies.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-3" data-testid="portal-assemblies">
          {assemblies.map((a) => (
            <li key={a.id}>
              <Card>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">
                      {ta("heading", { kind: ta(`kind.${a.kind}`), date: formatDate(a.heldOn) })}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {a.residenceName} · <bdi dir="ltr">{a.startTime}</bdi> · {a.place}
                    </p>
                  </div>
                  <AssemblyStatusBadge status={a.status} />
                </CardHeader>
                <CardContent className="space-y-3">
                  <ol className="space-y-1 text-sm">
                    {a.resolutions.map((r) => (
                      <li
                        key={r.position}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span>
                          {ta("agenda.number", { position: r.position })} · {r.title}
                          {r.titleAr ? (
                            <span className="text-muted-foreground">
                              {" · "}
                              <bdi dir="rtl" lang="ar">
                                {r.titleAr}
                              </bdi>
                            </span>
                          ) : null}
                        </span>
                        {a.status === "closed" && r.adopted !== null ? (
                          <ResolutionResultBadge adopted={r.adopted} />
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-4">
                    <PortalDocument fileId={a.convocationFileId} label={ta("pdf.convocation")} />
                    {a.status === "closed" ? (
                      <PortalDocument fileId={a.minutesFileId} label={ta("pdf.minutes")} />
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
