import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatShare, type VspWarning } from "@/lib/payment-plans";

/** VSP limit warnings (CLAUDE.md §12): shown, never blocking. */
export function VspWarnings({ warnings }: { warnings: VspWarning[] }) {
  const t = useTranslations("sales.warnings");
  if (warnings.length === 0) return null;
  return (
    <Alert data-testid="vsp-warnings">
      <TriangleAlert />
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc ps-4">
          {warnings.map((w) => (
            <li key={w.kind === "over_limit" ? w.stage : "unclassified"}>
              {w.kind === "over_limit"
                ? t("over_limit", {
                    stage: t(`stage.${w.stage}`),
                    cumulative: formatShare(w.cumulativeBp),
                    limit: formatShare(w.limitBp),
                  })
                : t("unclassified", { share: formatShare(w.shareBp) })}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
