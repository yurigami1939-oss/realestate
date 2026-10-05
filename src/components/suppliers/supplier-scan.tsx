"use client";

import { FileText, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { UploadButton } from "@/components/files/upload-button";
import { useRouter } from "@/i18n/navigation";

/** A contract's or an invoice's scan: link, then attach or replace (supplier:update). */
export function SupplierScan({
  purpose,
  entityId,
  fileId,
  editable,
}: {
  purpose: "supplier_contract.scan" | "supplier_invoice.scan";
  entityId: string;
  fileId: string | null;
  editable: boolean;
}) {
  const t = useTranslations("suppliers.scan");
  const router = useRouter();
  if (!fileId && !editable) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
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
