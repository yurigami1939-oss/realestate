"use client";

import { Download, FileCheck2, Loader2, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import type { Result } from "@/lib/result";
import {
  type ImportIssueView,
  type ImportKind,
  type ImportReport,
  MAX_IMPORT_BYTES,
} from "@/server/imports/schemas";

/** The first rows of a list of issues shown on the page (the rest is counted). */
const SHOWN = 200;

function IssueTable({ issues, tone }: { issues: ImportIssueView[]; tone: "error" | "warning" }) {
  const t = useTranslations();
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const message = (issue: ImportIssueView) => {
    const key = issue.messageKey as Parameters<typeof t>[0];
    return t.has(key) ? t(key, issue.values) : issue.messageKey;
  };
  return (
    <div className="space-y-1">
      <Table data-testid={tone === "error" ? "import-issues" : "import-warnings"}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("imports.columns.sheet")}</TableHead>
            <TableHead>{t("imports.columns.row")}</TableHead>
            <TableHead>{t("imports.columns.column")}</TableHead>
            <TableHead>{t("imports.columns.problem")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.slice(0, SHOWN).map((issue, i) => (
            <TableRow key={i}>
              <TableCell>{issue.sheet[locale]}</TableCell>
              <TableCell className="tabular-nums" dir="ltr">
                {issue.row ?? "—"}
              </TableCell>
              <TableCell>{issue.column?.[locale] ?? "—"}</TableCell>
              <TableCell
                className={
                  tone === "error" ? "whitespace-normal text-red-800" : "whitespace-normal"
                }
              >
                {message(issue)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {issues.length > SHOWN ? (
        <p className="text-xs text-muted-foreground">
          {t("imports.page.more", { count: issues.length - SHOWN })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One import (CLAUDE.md §7 Imports): download the template, pick the filled file, check it
 * (nothing is written), then import it once nothing blocks — all or nothing.
 */
export function ImportPanel({
  kind,
  target,
  fixed,
}: {
  kind: ImportKind;
  /** A target already known (a statement's account, from its page): sent, never asked. */
  fixed?: { param: "account"; id: string };
  /** The project (units) or residence (co-owners) the rows go to. */
  target?: {
    param: "project" | "residence";
    label: string;
    choices: { id: string; name: string }[];
  };
}) {
  const t = useTranslations("imports");
  const translate = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState<"check" | "import" | null>(null);
  const ready = file !== null && (!target || choice !== "");
  const counts = report ? Object.entries(report.counts) : [];
  const nothing = counts.every(([, n]) => n === 0);
  const importable = report !== null && !report.committed && report.issues.length === 0 && !nothing;

  async function send(commit: boolean) {
    if (!file) return;
    const fail = (key: string) => {
      const typed = key as Parameters<typeof translate>[0];
      toast.error(translate.has(typed) ? translate(typed) : key);
    };
    if (file.size > MAX_IMPORT_BYTES) return fail("files.errors.tooLarge");
    setPending(commit ? "import" : "check");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("commit", commit ? "1" : "0");
      if (target) body.set(target.param, choice);
      if (fixed) body.set(fixed.param, fixed.id);
      const response = await fetch(`/api/imports/${kind}`, { method: "POST", body });
      const result = (await response.json()) as Result<ImportReport>;
      if (!result.ok) return fail(result.error.messageKey);
      setReport(result.data);
      if (result.data.committed) {
        toast.success(t("page.done"));
        router.refresh();
      }
    } catch {
      fail("errors.UNEXPECTED");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4" data-testid={`import-${kind}`}>
      <div className="flex flex-wrap items-end gap-3">
        <Button asChild variant="outline" size="sm">
          <a href={`/api/imports/${kind}/template?locale=${locale}`}>
            <Download data-icon="inline-start" />
            {t("page.template")}
          </a>
        </Button>
        {target ? (
          <div className="space-y-1">
            <Label htmlFor={`import-${kind}-target`}>{target.label}</Label>
            <Select
              value={choice}
              onValueChange={(value) => {
                setChoice(value);
                setReport(null);
              }}
            >
              <SelectTrigger id={`import-${kind}-target`} className="min-w-48">
                <SelectValue placeholder={t("page.choose")} />
              </SelectTrigger>
              <SelectContent>
                {target.choices.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={`import-${kind}-file`}>{t("page.file")}</Label>
          <Input
            id={`import-${kind}-file`}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setReport(null);
            }}
          />
        </div>
        <Button size="sm" disabled={!ready || pending !== null} onClick={() => void send(false)}>
          {pending === "check" ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <FileCheck2 data-icon="inline-start" />
          )}
          {t("page.check")}
        </Button>
        {importable ? (
          <Button size="sm" disabled={pending !== null} onClick={() => void send(true)}>
            {pending === "import" ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Upload data-icon="inline-start" />
            )}
            {t("page.import")}
          </Button>
        ) : null}
      </div>

      {report ? (
        <div className="space-y-3" data-testid="import-report">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {report.committed ? (
              <Badge variant="outline" className="text-emerald-800">
                {t("page.imported")}
              </Badge>
            ) : report.issues.length > 0 ? (
              <Badge variant="outline" className="text-red-800">
                {t("page.blocked", { count: report.issues.length })}
              </Badge>
            ) : nothing ? (
              <Badge variant="outline">{t("page.nothing")}</Badge>
            ) : (
              <Badge variant="outline" className="text-emerald-800">
                {t("page.ready")}
              </Badge>
            )}
            {counts.map(([key, n]) => (
              <span key={key} className="text-muted-foreground">
                {t(`counts.${key as "units"}`, { count: n })}
              </span>
            ))}
          </div>
          {report.issues.length > 0 ? <IssueTable issues={report.issues} tone="error" /> : null}
          {report.warnings.length > 0 ? (
            <div className="space-y-1">
              <p className="text-sm text-amber-800">
                {t("page.leftAside", { count: report.warnings.length })}
              </p>
              <IssueTable issues={report.warnings} tone="warning" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
