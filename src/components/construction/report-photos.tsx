"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { UploadButton } from "@/components/files/upload-button";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { useRouter } from "@/i18n/navigation";
import { removeReportPhotoAction } from "@/server/construction/actions";
import { MAX_REPORT_PHOTOS } from "@/server/construction/schemas";

/** Site photos of a report; editors add (one at a time) and remove them. */
export function ReportPhotos({
  reportId,
  photos,
  editable,
}: {
  reportId: string;
  photos: { id: string; fileName: string }[];
  editable: boolean;
}) {
  const t = useTranslations("construction.photos");
  const router = useRouter();
  if (photos.length === 0 && !editable) return null;
  return (
    <div className="space-y-2">
      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="report-photos">
          {photos.map((photo, index) => (
            <li key={photo.id} className="relative">
              <a href={`/api/files/${photo.id}`} target="_blank" rel="noopener" title={t("open")}>
                {/* Presigned S3 redirect: next/image cannot optimize it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/files/${photo.id}`}
                  alt={t("alt", { index: index + 1 })}
                  loading="lazy"
                  className="aspect-[4/3] w-full rounded-md border object-cover"
                />
              </a>
              {editable ? (
                <div className="absolute end-1 top-1 rounded-md bg-background/90">
                  <ConfirmAction
                    action={removeReportPhotoAction}
                    input={{ reportId, fileId: photo.id }}
                    label={t("remove", { index: index + 1 })}
                    icon={<Trash2 />}
                    size="icon"
                    variant="ghost"
                    title={t("removeTitle")}
                    description={t("removeDescription")}
                    confirmLabel={t("removeConfirm")}
                    successMessage={t("removed")}
                    destructive
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {editable && photos.length < MAX_REPORT_PHOTOS ? (
        <UploadButton
          purpose="construction_report.photo"
          entityId={reportId}
          label={t("add")}
          icon={<ImagePlus data-icon="inline-start" />}
          onUploaded={() => {
            toast.success(t("added"));
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
