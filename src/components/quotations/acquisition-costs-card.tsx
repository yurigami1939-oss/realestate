import { useLocale, useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AcquisitionCosts } from "@/lib/acquisition-costs";
import { type Centimes, formatDZD } from "@/lib/money";

type Props = { costs: AcquisitionCosts; price: Centimes };

/**
 * A buyer's estimated acquisition costs on top of the price (quotation page and form): the
 * notary's fees and their VAT, the duties, fixed costs, and the total cost.
 */
export function AcquisitionCostsList({ costs, price }: Props) {
  const t = useTranslations("acquisitionCosts");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const rows = [
    { key: "notaryFees", label: t("notaryFees"), value: costs.notaryFees },
    { key: "notaryVat", label: t("notaryVatAmount"), value: costs.notaryVat },
    { key: "registration", label: t("registrationAmount"), value: costs.registration },
    { key: "publication", label: t("publicationAmount"), value: costs.publication },
    { key: "fixedFees", label: t("fixedFeesAmount"), value: costs.fixedFees },
  ].filter((row) => row.value > 0n);
  return (
    <div className="space-y-3" data-testid="acquisition-costs">
      <dl className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="flex justify-between gap-3 border-b pb-1.5">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd dir="ltr">{formatDZD(row.value, locale)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-b pb-1.5 font-medium">
          <dt>{t("total")}</dt>
          <dd dir="ltr">{formatDZD(costs.total, locale)}</dd>
        </div>
        <div className="flex justify-between gap-3 font-semibold">
          <dt>{t("grandTotal")}</dt>
          <dd dir="ltr">{formatDZD(price + costs.total, locale)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{t("indicative")}</p>
    </div>
  );
}

/** The same in a card of its own (quotation page). */
export function AcquisitionCostsCard(props: Props) {
  const t = useTranslations("acquisitionCosts");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("estimate")}</CardTitle>
      </CardHeader>
      <CardContent>
        <AcquisitionCostsList {...props} />
      </CardContent>
    </Card>
  );
}
