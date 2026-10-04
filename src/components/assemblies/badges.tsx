import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { AssemblyStatus } from "@/lib/assemblies";

const variants: Record<AssemblyStatus, "outline" | "secondary" | "default"> = {
  draft: "outline",
  convened: "secondary",
  closed: "default",
};

export function AssemblyStatusBadge({ status }: { status: AssemblyStatus }) {
  const t = useTranslations("assemblies.status");
  return <Badge variant={variants[status]}>{t(status)}</Badge>;
}

/** Frozen result of a resolution (closed assemblies only). */
export function ResolutionResultBadge({ adopted }: { adopted: boolean }) {
  const t = useTranslations("assemblies.result");
  return (
    <Badge
      variant="outline"
      className={
        adopted
          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
          : "border-red-300 bg-red-50 text-red-900"
      }
    >
      {adopted ? t("adopted") : t("rejected")}
    </Badge>
  );
}
