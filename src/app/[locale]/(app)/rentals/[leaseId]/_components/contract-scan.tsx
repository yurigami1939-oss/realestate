"use client";

import { ExternalLink, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { UploadButton } from "@/components/files/upload-button";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

/** The signed lease (scan): link, then attach or replace. */
export function ContractScan({
  leaseId,
  fileId,
  fileName,
  editable,
}: {
  leaseId: string;
  fileId: string | null;
  fileName: string | null;
  editable: boolean;
}) {
  const t = useTranslations("rentals.scan");
  const ts = useTranslations("sales");
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="lease-scan">
      <div className="min-w-0">
        <div className="text-sm font-medium">{t("title")}</div>
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
          <div className="text-sm text-muted-foreground">{ts("noScan")}</div>
        )}
      </div>
      {editable ? (
        <UploadButton
          purpose="lease.contract"
          entityId={leaseId}
          label={fileId ? ts("replace") : ts("attach")}
          icon={<Upload data-icon="inline-start" />}
          onUploaded={() => {
            toast.success(ts("scanSaved"));
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
