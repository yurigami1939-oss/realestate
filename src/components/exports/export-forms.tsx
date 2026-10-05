"use client";

import { Download } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ExportKind, exportHref } from "@/server/exports/schemas";

function DownloadLink({ kind, params }: { kind: ExportKind; params: Record<string, string> }) {
  const t = useTranslations("exports");
  const locale = useLocale();
  return (
    <Button asChild size="sm">
      <a href={exportHref(kind, { ...params, locale })} data-testid={`export-${kind}`}>
        <Download data-icon="inline-start" />
        {t("download")}
      </a>
    </Button>
  );
}

/** Journal des encaissements over a period (this month by default). */
export function CollectionsExport({ from, to }: { from: string; to: string }) {
  const t = useTranslations("exports.page");
  const [range, setRange] = useState({ from, to });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="export-from">{t("from")}</Label>
        <Input
          id="export-from"
          type="date"
          dir="ltr"
          value={range.from}
          onChange={(e) => setRange({ ...range, from: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="export-to">{t("to")}</Label>
        <Input
          id="export-to"
          type="date"
          dir="ltr"
          value={range.to}
          onChange={(e) => setRange({ ...range, to: e.target.value })}
        />
      </div>
      <DownloadLink kind="collections" params={range} />
    </div>
  );
}

const ALL = "__all__";

/** An export filtered by one choice (a project, a residence…), optionally « all ». */
export function ChoiceExport({
  kind,
  param,
  label,
  choices,
  allLabel,
  extra = {},
}: {
  kind: ExportKind;
  param: string;
  label: string;
  choices: { id: string; name: string }[];
  /** When set, the export can run without a choice. */
  allLabel?: string;
  extra?: Record<string, string>;
}) {
  const [value, setValue] = useState(allLabel ? ALL : (choices[0]?.id ?? ""));
  if (choices.length === 0 && !allLabel) return null;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor={`export-${kind}-${param}`}>{label}</Label>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger id={`export-${kind}-${param}`} className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allLabel ? <SelectItem value={ALL}>{allLabel}</SelectItem> : null}
            {choices.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DownloadLink
        kind={kind}
        params={{ ...extra, ...(value === ALL ? {} : { [param]: value }) }}
      />
    </div>
  );
}

/** An export without filters. */
export function PlainExport({ kind }: { kind: ExportKind }) {
  return <DownloadLink kind={kind} params={{}} />;
}
