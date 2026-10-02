"use client";

import { ExternalLink, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { UploadButton } from "@/components/files/upload-button";
import { useAction } from "@/components/forms/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import { documentStatuses, type DocumentStatus } from "@/lib/sales";
import { cn } from "@/lib/utils";
import { setBuyerDocumentAction } from "@/server/buyers/actions";
import type { BuyerDetail } from "@/server/buyers/queries";

const statusClasses: Record<DocumentStatus, string> = {
  missing: "text-amber-800",
  received: "text-sky-800",
  verified: "text-emerald-800",
};

/** Checklist of the buyer's documents: status per item, optional scan (never blocking). */
export function DocumentsChecklist({
  buyerId,
  documents,
  editable,
}: {
  buyerId: string;
  documents: BuyerDetail["documents"];
  editable: boolean;
}) {
  const t = useTranslations("buyers.documents");
  const router = useRouter();
  const save = useAction(setBuyerDocumentAction);

  return (
    <Table data-testid="buyer-documents">
      <TableBody>
        {documents.map((d) => (
          <TableRow key={d.kind} data-kind={d.kind}>
            <TableCell className="whitespace-normal">
              <span className="font-medium">{t(`kind.${d.kind}`)}</span>
              {d.required ? (
                <Badge variant="outline" className="ms-2">
                  {t("required")}
                </Badge>
              ) : null}
              {d.fileName ? (
                <span className="block text-xs text-muted-foreground" dir="auto">
                  {d.fileName}
                </span>
              ) : null}
            </TableCell>
            <TableCell>
              {editable ? (
                <Select
                  value={d.status}
                  disabled={save.pending}
                  onValueChange={(status) =>
                    void save.run(
                      {
                        buyerId,
                        kind: d.kind,
                        status: status as DocumentStatus,
                        note: d.note ?? "",
                      },
                      { onSuccess: () => toast.success(t("updated")) },
                    )
                  }
                >
                  <SelectTrigger
                    className={cn("h-8 w-full", statusClasses[d.status])}
                    aria-label={t(`kind.${d.kind}`)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {documentStatuses.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`status.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className={cn("text-sm font-medium", statusClasses[d.status])}>
                  {t(`status.${d.status}`)}
                </span>
              )}
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                {d.fileId ? (
                  <Button asChild variant="ghost" size="sm">
                    <a href={`/api/files/${d.fileId}`} target="_blank" rel="noopener">
                      <ExternalLink data-icon="inline-start" />
                      {t("view")}
                    </a>
                  </Button>
                ) : null}
                {editable ? (
                  <UploadButton
                    purpose="buyer.document"
                    entityId={buyerId}
                    detail={d.kind}
                    label={d.fileId ? t("replace") : t("upload")}
                    icon={<Upload data-icon="inline-start" />}
                    variant="ghost"
                    onUploaded={() => {
                      toast.success(t("uploaded"));
                      router.refresh();
                    }}
                  />
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
