"use client";

import { FileText, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { requestHandoverDocumentAction } from "@/server/handovers/actions";

/** Link to a delivery PV; while the worker renders it, a pending note and a retry button. */
export function HandoverDocumentPdf({
  fileId,
  kind,
  handoverId,
  label,
}: {
  fileId: string | null;
  kind: "handover_pv" | "handover_release";
  handoverId: string;
  label: string;
}) {
  const t = useTranslations("sales.documents");
  const retry = useAction(requestHandoverDocumentAction);
  if (fileId) {
    return (
      <Button asChild variant="link" size="sm" className="h-auto px-0">
        <a href={`/api/files/${fileId}`} target="_blank" rel="noopener">
          <FileText data-icon="inline-start" />
          {label}
        </a>
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {t("pending")}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={t("retry")}
        disabled={retry.pending}
        onClick={() =>
          void retry.run({ kind, handoverId }, { onSuccess: () => toast.success(t("requested")) })
        }
      >
        <RefreshCw />
      </Button>
    </span>
  );
}
