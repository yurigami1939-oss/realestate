import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { formatShare } from "@/lib/payment-plans";
import type { ConstructionReportRow } from "@/server/construction/queries";

import { ReportPhotos } from "./report-photos";

/**
 * A progress report: staff read both languages and see whether buyers see it; buyers (portal)
 * read it in their language when the Arabic text exists.
 */
export function ReportCard({
  report,
  variant,
  locale,
  editable = false,
  actions,
}: {
  report: ConstructionReportRow;
  variant: "staff" | "portal";
  locale: "fr" | "ar";
  editable?: boolean;
  actions?: React.ReactNode;
}) {
  const t = useTranslations("construction.report");
  const arabic = variant === "portal" && locale === "ar";
  const title = arabic && report.titleAr ? report.titleAr : report.title;
  const body = arabic && report.bodyAr ? report.bodyAr : report.body;
  return (
    <Card data-testid="construction-report" data-report={report.title}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{formatDate(report.reportedOn)}</span>
            {variant === "staff" ? (
              <Badge variant="outline">{report.published ? t("published") : t("internal")}</Badge>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap gap-1">{actions}</div> : null}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {body ? <p className="whitespace-pre-line">{body}</p> : null}
        {variant === "staff" && (report.titleAr || report.bodyAr) ? (
          <div className="space-y-1 rounded-md bg-muted/40 p-2" dir="rtl" lang="ar">
            {report.titleAr ? <p className="font-medium">{report.titleAr}</p> : null}
            {report.bodyAr ? <p className="whitespace-pre-line">{report.bodyAr}</p> : null}
          </div>
        ) : null}
        {report.progress.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label={t("progressLabel")}>
            {report.progress.map((p) => (
              <li key={p.buildingId}>
                <Badge variant="secondary">
                  {p.buildingName} · <bdi dir="ltr">{formatShare(p.percent * 100)}</bdi>
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <ReportPhotos reportId={report.id} photos={report.photos} editable={editable} />
      </CardContent>
    </Card>
  );
}
