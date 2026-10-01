import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { ConfirmAction } from "@/components/forms/confirm-action";
import { type OptionLeadChoice, PlaceOptionDialog } from "@/components/sales/option-dialogs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { formatDateTime } from "@/lib/dates";
import type { UnitStatus } from "@/lib/inventory";
import { cancelOptionAction } from "@/server/sales/actions";
import type { UnitOptionInfo } from "@/server/sales/queries";

/** Commercial actions on a unit: place an option when available, lift it when optioned. */
export function UnitSaleCard({
  unitId,
  code,
  status,
  option,
  leads,
  optionHours,
  canSell,
}: {
  unitId: string;
  code: string;
  status: UnitStatus;
  option: UnitOptionInfo | null;
  leads: OptionLeadChoice[];
  optionHours: number;
  canSell: boolean;
}) {
  const t = useTranslations("sales.options");
  if (status !== "available" && !option) return null;
  if (status === "available" && !canSell) return null;

  return (
    <Card data-testid="unit-sale">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {option ? (
          <>
            <p>
              {option.leadVisible && option.leadName
                ? t.rich("heldFor", {
                    name: option.leadName,
                    date: formatDateTime(option.expiresAt),
                    lead: (chunks) => (
                      <Link
                        href={`/leads/${option.leadId}`}
                        className="font-medium hover:underline"
                      >
                        {chunks}
                      </Link>
                    ),
                  })
                : t("heldUntil", { date: formatDateTime(option.expiresAt) })}
            </p>
            {canSell && option.leadVisible ? (
              <ConfirmAction
                action={cancelOptionAction}
                input={{ optionId: option.id, reason: "" }}
                label={t("cancel")}
                icon={<X data-icon="inline-start" />}
                title={t("cancelTitle", { code })}
                description={t("cancelDescription")}
                confirmLabel={t("cancel")}
                successMessage={t("cancelled")}
                variant="outline"
              />
            ) : null}
          </>
        ) : (
          <PlaceOptionDialog unitId={unitId} leads={leads} optionHours={optionHours} />
        )}
      </CardContent>
    </Card>
  );
}
