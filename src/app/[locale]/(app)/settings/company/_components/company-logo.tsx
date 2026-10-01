"use client";

import { Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { UploadButton } from "@/components/files/upload-button";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/i18n/navigation";
import { removeCompanyLogoAction } from "@/server/organizations/actions";

/** Company logo printed on the documents: preview, upload (PNG/JPEG), removal. */
export function CompanyLogo({ orgId, logoFileId }: { orgId: string; logoFileId: string | null }) {
  const t = useTranslations("company.logo");
  const router = useRouter();
  return (
    <Card data-testid="company-logo">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex min-h-20 items-center justify-center rounded-md border border-dashed p-3">
          {logoFileId ? (
            // A member's own upload served through the access-checked file route.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${logoFileId}`} alt={t("alt")} className="max-h-20 max-w-60" />
          ) : (
            <span className="text-sm text-muted-foreground">{t("none")}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <UploadButton
            purpose="organization.logo"
            entityId={orgId}
            label={logoFileId ? t("replace") : t("upload")}
            icon={<Upload data-icon="inline-start" />}
            onUploaded={() => {
              toast.success(t("uploaded"));
              router.refresh();
            }}
          />
          {logoFileId ? (
            <ConfirmAction
              action={removeCompanyLogoAction}
              input={{}}
              label={t("remove")}
              icon={<Trash2 data-icon="inline-start" />}
              title={t("removeTitle")}
              description={t("removeDescription")}
              confirmLabel={t("remove")}
              successMessage={t("removed")}
              variant="ghost"
              destructive
            />
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
      </CardContent>
    </Card>
  );
}
