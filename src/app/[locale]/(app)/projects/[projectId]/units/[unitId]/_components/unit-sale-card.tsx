import { FileSignature, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { ConfirmAction } from "@/components/forms/confirm-action";
import { SaleStatusBadge } from "@/components/sales/badges";
import { type OptionLeadChoice, PlaceOptionDialog } from "@/components/sales/option-dialogs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { formatDateTime } from "@/lib/dates";
import type { UnitStatus } from "@/lib/inventory";
import type { ReservationStatus } from "@/lib/sales";
import { cancelOptionAction } from "@/server/sales/actions";
import type { UnitOptionInfo } from "@/server/sales/queries";

/**
 * Commercial actions on a unit: place an option or reserve when available, lift the option
 * or reserve for its lead when optioned; once reserved, the link to its sale.
 */
export function UnitSaleCard({
  unitId,
  code,
  status,
  option,
  sale,
  leads,
  optionHours,
  canSell,
  priced,
}: {
  unitId: string;
  code: string;
  status: UnitStatus;
  option: UnitOptionInfo | null;
  sale: { id: string; number: string; status: ReservationStatus } | null;
  leads: OptionLeadChoice[];
  optionHours: number;
  canSell: boolean;
  priced: boolean;
}) {
  const t = useTranslations("sales.options");
  const ts = useTranslations("sales");
  const canReserve =
    canSell && priced && (status === "available" || (option !== null && option.leadVisible));
  if (sale) {
    return (
      <Card data-testid="unit-sale">
        <CardHeader>
          <CardTitle className="text-base">{ts("unitCardTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/sales/${sale.id}`} className="font-medium hover:underline">
            {ts("openSale", { number: sale.number })}
          </Link>
          <SaleStatusBadge status={sale.status} />
        </CardContent>
      </Card>
    );
  }
  if (status !== "available" && !option) return null;
  if (status === "available" && !canSell) return null;

  const reserve = canReserve ? (
    <Button asChild variant={option ? "default" : "outline"}>
      <Link href={`/sales/new?unitId=${unitId}`}>
        <FileSignature data-icon="inline-start" />
        {ts("reserve")}
      </Link>
    </Button>
  ) : null;

  return (
    <Card data-testid="unit-sale">
      <CardHeader>
        <CardTitle className="text-base">{ts("unitCardTitle")}</CardTitle>
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
            <div className="flex flex-wrap gap-2">
              {reserve}
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
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            <PlaceOptionDialog unitId={unitId} leads={leads} optionHours={optionHours} />
            {reserve}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
