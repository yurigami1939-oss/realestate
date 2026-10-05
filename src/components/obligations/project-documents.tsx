import { AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { ConfirmAction } from "@/components/forms/confirm-action";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type CalendarDate, formatDate } from "@/lib/dates";
import { documentValidity, essentialProjectDocuments } from "@/lib/obligations";
import { deleteProjectDocumentAction } from "@/server/obligations/actions";
import type { ProjectDocumentRow } from "@/server/obligations/queries";

import { DocumentScan } from "./document-scan";
import { ProjectDocumentDialog } from "./project-document-dialog";

const validityTone = { expired: "text-red-800", expiring: "text-amber-800" } as const;

/**
 * A project's regulatory file (dossier administratif): the essential documents held or
 * missing, then every document with its validity and scan.
 */
export function ProjectDocuments({
  projectId,
  documents,
  today,
  editable,
}: {
  projectId: string;
  documents: ProjectDocumentRow[];
  today: CalendarDate;
  editable: boolean;
}) {
  const t = useTranslations("obligations.documents");
  const tc = useTranslations("common");
  return (
    <section className="space-y-4" data-testid="project-documents">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {editable ? <ProjectDocumentDialog projectId={projectId} /> : null}
      </div>
      <ul className="flex flex-wrap gap-2" data-testid="project-documents-checklist">
        {essentialProjectDocuments.map((kind) => {
          const held = documents.some((d) => d.kind === kind);
          return (
            <li key={kind}>
              <Badge variant="outline" className={held ? "text-emerald-800" : "text-amber-800"}>
                {held ? (
                  <CheckCircle2 data-icon="inline-start" />
                ) : (
                  <AlertTriangle data-icon="inline-start" />
                )}
                {held ? t(`kind.${kind}`) : t("missing", { document: t(`kind.${kind}`) })}
              </Badge>
            </li>
          );
        })}
      </ul>
      {documents.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.document")}</TableHead>
                <TableHead>{t("columns.reference")}</TableHead>
                <TableHead>{t("columns.issuedOn")}</TableHead>
                <TableHead>{t("columns.expiresOn")}</TableHead>
                <TableHead>{t("columns.scan")}</TableHead>
                <TableHead>
                  <span className="sr-only">{tc("actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((d) => {
                const validity = documentValidity(d.expiresOn, today);
                return (
                  <TableRow key={d.id} data-kind={d.kind}>
                    <TableCell className="whitespace-normal">
                      <div className="font-medium">{t(`kind.${d.kind}`)}</div>
                      {d.title || d.issuer ? (
                        <div className="text-xs text-muted-foreground">
                          {[d.title, d.issuer].filter(Boolean).join(" · ")}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <bdi dir="ltr">{d.reference ?? "—"}</bdi>
                    </TableCell>
                    <TableCell className="tabular-nums" dir="ltr">
                      {d.issuedOn ? formatDate(d.issuedOn) : "—"}
                    </TableCell>
                    <TableCell>
                      {d.expiresOn ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <span className="tabular-nums" dir="ltr">
                            {formatDate(d.expiresOn)}
                          </span>
                          {validity === "expired" || validity === "expiring" ? (
                            <Badge variant="outline" className={validityTone[validity]}>
                              {t(`validity.${validity}`)}
                            </Badge>
                          ) : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <DocumentScan
                        purpose="project_document.scan"
                        entityId={d.id}
                        fileId={d.scanFileId}
                        editable={editable}
                      />
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <div className="flex justify-end gap-1">
                          <ProjectDocumentDialog
                            documentId={d.id}
                            values={{
                              kind: d.kind,
                              title: d.title ?? "",
                              reference: d.reference ?? "",
                              issuedOn: d.issuedOn ?? "",
                              expiresOn: d.expiresOn ?? "",
                              issuer: d.issuer ?? "",
                              notes: d.notes ?? "",
                            }}
                          />
                          <ConfirmAction
                            action={deleteProjectDocumentAction}
                            input={{ documentId: d.id }}
                            label={tc("delete")}
                            icon={<Trash2 />}
                            title={t("deleteTitle")}
                            description={t("deleteDescription")}
                            confirmLabel={tc("delete")}
                            successMessage={t("deleted")}
                            variant="ghost"
                            size="icon"
                            destructive
                          />
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
