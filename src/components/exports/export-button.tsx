"use client";

import { FileSpreadsheet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { type ExportKind, exportHref } from "@/server/exports/schemas";

/** « Exporter (Excel) »: downloads the list's spreadsheet, with its current filters. */
export function ExportButton({
  kind,
  params = {},
  label,
}: {
  kind: ExportKind;
  params?: Record<string, string | number | null | undefined>;
  label?: string;
}) {
  const t = useTranslations("exports");
  const locale = useLocale();
  return (
    <Button asChild variant="outline">
      <a href={exportHref(kind, { ...params, locale })} data-testid={`export-${kind}`}>
        <FileSpreadsheet data-icon="inline-start" />
        {label ?? t("button")}
      </a>
    </Button>
  );
}
