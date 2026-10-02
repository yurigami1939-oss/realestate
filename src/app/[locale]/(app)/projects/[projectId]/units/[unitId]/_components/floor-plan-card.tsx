"use client";

import { Download, FileText, Trash2, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { UploadButton } from "@/components/files/upload-button";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/i18n/navigation";
import { formatFileSize, isImage } from "@/lib/files";
import { removeUnitFloorPlanAction } from "@/server/inventory/actions";
import type { UnitDetail } from "@/server/inventory/queries";

export function FloorPlanCard({
  unitId,
  code,
  plan,
  editable,
}: {
  unitId: string;
  code: string;
  plan: UnitDetail["floorPlan"];
  editable: boolean;
}) {
  const t = useTranslations("inventory.units.floorPlan");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const router = useRouter();
  const href = plan ? `/api/files/${plan.id}` : null;

  return (
    <Card data-testid="floor-plan">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {plan && href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener"
            className="block rounded-md border transition-colors hover:bg-muted/40"
            title={t("open")}
          >
            {isImage(plan.contentType) ? (
              // Presigned S3 redirect: next/image cannot optimize it.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={href}
                alt={t("alt", { code })}
                className="max-h-64 w-full rounded-md object-contain"
              />
            ) : null}
            <span className="flex items-center gap-3 p-3">
              <FileText className="size-8 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium" dir="auto">
                  {plan.fileName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatFileSize(plan.sizeBytes, locale)}
                </span>
              </span>
            </span>
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {href ? (
            <Button asChild variant="outline">
              <a href={`${href}?download`}>
                <Download data-icon="inline-start" />
                {t("download")}
              </a>
            </Button>
          ) : null}
          {editable ? (
            <UploadButton
              purpose="unit.floor_plan"
              entityId={unitId}
              label={plan ? t("replace") : t("upload")}
              icon={<Upload data-icon="inline-start" />}
              onUploaded={() => {
                toast.success(t("uploaded"));
                router.refresh();
              }}
            />
          ) : null}
          {editable && plan ? (
            <ConfirmAction
              action={removeUnitFloorPlanAction}
              input={{ unitId }}
              label={t("remove")}
              icon={<Trash2 data-icon="inline-start" />}
              title={t("removeTitle", { code })}
              description={t("removeDescription")}
              confirmLabel={t("remove")}
              successMessage={t("removed")}
              variant="ghost"
              destructive
            />
          ) : null}
        </div>
        {editable ? <p className="text-xs text-muted-foreground">{t("hint")}</p> : null}
      </CardContent>
    </Card>
  );
}
