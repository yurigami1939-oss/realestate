"use client";

import { FileDown, FileText, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useAction } from "@/components/forms/use-action";
import { PendingDocumentsRefresher } from "@/components/sales/document-pdf";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { issueUnitSheetAction } from "@/server/inventory/unit-sheet-actions";

/** Fiche du lot (PDF) to hand to a prospect: drawn on demand, the latest ones listed. */
export function UnitSheetsCard({
  unitId,
  sheets,
}: {
  unitId: string;
  sheets: { id: string; issuedOn: string; createdByName: string; pdfFileId: string | null }[];
}) {
  const t = useTranslations("inventory.sheet");
  const issue = useAction(issueUnitSheetAction);
  return (
    <Card data-testid="unit-sheets">
      <PendingDocumentsRefresher pending={sheets.some((s) => s.pdfFileId === null)} />
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={issue.pending}
          onClick={() =>
            issue.run(
              { unitId },
              { onSuccess: ({ reused }) => toast.success(t(reused ? "reused" : "issued")) },
            )
          }
        >
          <FileDown data-icon="inline-start" />
          {t("issue")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p className="text-muted-foreground">{t("hint")}</p>
        {sheets.map((s) =>
          s.pdfFileId ? (
            <Button key={s.id} asChild variant="link" size="sm" className="h-auto px-0">
              <a href={`/api/files/${s.pdfFileId}`} target="_blank" rel="noopener">
                <FileText data-icon="inline-start" />
                {t("line", { date: formatDate(s.issuedOn), name: s.createdByName })}
              </a>
            </Button>
          ) : (
            <span key={s.id} className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("pending")}
            </span>
          ),
        )}
      </CardContent>
    </Card>
  );
}
