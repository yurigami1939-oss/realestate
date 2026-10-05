"use client";

import { FileText, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { UploadButton } from "@/components/files/upload-button";
import { useRouter } from "@/i18n/navigation";

/**
 * The scan of a regulatory document or of a sale's FGCMPI guarantee: link, then attach or
 * replace.
 */
export function DocumentScan({
  purpose,
  entityId,
  fileId,
  editable,
}: {
  purpose: "project_document.scan" | "reservation.guarantee";
  entityId: string;
  fileId: string | null;
  editable: boolean;
}) {
  const t = useTranslations("obligations.scan");
  const router = useRouter();
  if (!fileId && !editable) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {fileId ? (
        <a
          href={`/api/files/${fileId}`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 font-medium hover:underline"
        >
          <FileText className="size-3.5" aria-hidden />
          {t("open")}
        </a>
      ) : null}
      {editable ? (
        <UploadButton
          purpose={purpose}
          entityId={entityId}
          label={fileId ? t("replace") : t("attach")}
          icon={<Upload data-icon="inline-start" />}
          variant="ghost"
          onUploaded={() => {
            toast.success(t("saved"));
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
