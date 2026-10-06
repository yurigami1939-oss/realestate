"use client";

import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { UploadButton } from "@/components/files/upload-button";
import { useRouter } from "@/i18n/navigation";
import type { BuyerDocumentKind } from "@/lib/sales";

/** A buyer sends (or replaces) one piece of their file from the portal. */
export function PortalDocumentUpload({
  buyerId,
  kind,
  replace,
}: {
  buyerId: string;
  kind: BuyerDocumentKind;
  replace: boolean;
}) {
  const t = useTranslations("portal.documents");
  const router = useRouter();
  return (
    <UploadButton
      purpose="portal.buyer_document"
      entityId={buyerId}
      detail={kind}
      label={replace ? t("replace") : t("send")}
      icon={<Upload data-icon="inline-start" />}
      onUploaded={() => {
        toast.success(t("sent"));
        router.refresh();
      }}
    />
  );
}
