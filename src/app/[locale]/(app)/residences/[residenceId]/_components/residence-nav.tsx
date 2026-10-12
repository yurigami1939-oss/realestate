import { useTranslations } from "next-intl";

import { SegmentedNav } from "@/components/app-shell/segmented-nav";
import { type Access, can, type Permission } from "@/lib/permissions";

const sections = [
  { key: "units", path: "", permission: "residence:read" },
  { key: "charges", path: "/charges", permission: "charge:read" },
  { key: "calls", path: "/calls", permission: "charge:read" },
  { key: "accounts", path: "/accounts", permission: "charge:read" },
  { key: "meters", path: "/meters", permission: "charge:read" },
  { key: "expenses", path: "/expenses", permission: "supplier:read" },
  { key: "report", path: "/report", permission: "charge:read" },
  { key: "staff", path: "/staff", permission: "staff:read" },
  { key: "checks", path: "/checks", permission: "residence:read" },
  { key: "rooms", path: "/rooms", permission: "residence:read" },
  { key: "visitors", path: "/visitors", permission: "visitor:read" },
  { key: "assemblies", path: "/assemblies", permission: "assembly:read" },
  { key: "announcements", path: "/announcements", permission: "announcement:read" },
] as const satisfies readonly { key: string; path: string; permission: Permission }[];

export type ResidenceSection = (typeof sections)[number]["key"];

/** Sections of a residence, as a segmented control; those the member may not read are hidden. */
export function ResidenceNav({
  residenceId,
  current,
  roles,
}: {
  residenceId: string;
  current: ResidenceSection;
  roles: Access;
}) {
  const t = useTranslations("residences.tabs");
  return (
    <SegmentedNav
      label={t("label")}
      current={current}
      segments={sections
        .filter((s) => can(roles, s.permission))
        .map((s) => ({ key: s.key, href: `/residences/${residenceId}${s.path}`, label: t(s.key) }))}
    />
  );
}
