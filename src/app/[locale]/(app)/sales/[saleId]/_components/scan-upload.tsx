"use client";

import { ExternalLink, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { UploadButton } from "@/components/files/upload-button";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

/** A signed scan of the sale (reservation contract or VSP deed): link, then attach/replace. */
export function ScanUpload({
  reservationId,
  kind,
  label,
  fileId,
  fileName,
  editable,
}: {
  reservationId: string;
  kind: "contract" | "deed";
  label: string;
  fileId: string | null;
  fileName: string | null;
  editable: boolean;
}) {
  const t = useTranslations("sales");
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid={`scan-${kind}`}>
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {fileId ? (
          <Button asChild variant="link" size="sm" className="h-auto px-0">
            <a href={`/api/files/${fileId}`} target="_blank" rel="noopener">
              <ExternalLink data-icon="inline-start" />
              <span className="truncate" dir="auto">
                {fileName}
              </span>
            </a>
          </Button>
        ) : (
          <div className="text-sm text-muted-foreground">{t("noScan")}</div>
        )}
      </div>
      {editable ? (
        <UploadButton
          purpose={kind === "contract" ? "reservation.contract" : "reservation.deed"}
          entityId={reservationId}
          label={fileId ? t("replace") : t("attach")}
          icon={<Upload data-icon="inline-start" />}
          onUploaded={() => {
            toast.success(t("scanSaved"));
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
