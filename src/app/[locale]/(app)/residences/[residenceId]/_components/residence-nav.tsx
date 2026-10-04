import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { can, type Permission, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const sections = [
  { key: "units", path: "", permission: "residence:read" },
  { key: "charges", path: "/charges", permission: "charge:read" },
  { key: "calls", path: "/calls", permission: "charge:read" },
  { key: "accounts", path: "/accounts", permission: "charge:read" },
  { key: "expenses", path: "/expenses", permission: "supplier:read" },
  { key: "report", path: "/report", permission: "charge:read" },
  { key: "staff", path: "/staff", permission: "staff:read" },
] as const satisfies readonly { key: string; path: string; permission: Permission }[];

export type ResidenceSection = (typeof sections)[number]["key"];

/** Sections of a residence, as tabs; those the member may not read are hidden. */
export function ResidenceNav({
  residenceId,
  current,
  roles,
}: {
  residenceId: string;
  current: ResidenceSection;
  roles: readonly Role[];
}) {
  const t = useTranslations("residences.tabs");
  return (
    <nav aria-label={t("label")} className="flex gap-1 overflow-x-auto border-b">
      {sections
        .filter((s) => can(roles, s.permission))
        .map((s) => (
          <Link
            key={s.key}
            href={`/residences/${residenceId}${s.path}`}
            aria-current={s.key === current ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2 text-sm whitespace-nowrap",
              s.key === current
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(s.key)}
          </Link>
        ))}
    </nav>
  );
}
