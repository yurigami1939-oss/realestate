import { useTranslations } from "next-intl";

import { SegmentedNav } from "@/components/app-shell/segmented-nav";
import { type Access, can } from "@/lib/permissions";

export type ProjectSection = "overview" | "priceLists" | "paymentPlans" | "costs";

/**
 * A project's pages as a segmented control (CLAUDE.md §14 item 16): its sheet, price lists,
 * payment plans, costs, and its construction follow-up; a third party's building has only its
 * sheet (nothing of the sales side).
 */
export function ProjectNav({
  projectId,
  current,
  access,
  forSale,
}: {
  projectId: string;
  current: ProjectSection;
  access: Access;
  forSale: boolean;
}) {
  const t = useTranslations();
  if (!forSale) return null;
  const segments = [
    {
      key: "overview",
      href: `/projects/${projectId}`,
      label: t("inventory.projects.tabs.overview"),
    },
    {
      key: "priceLists",
      href: `/projects/${projectId}/price-lists`,
      label: t("inventory.priceLists.title"),
    },
    {
      key: "paymentPlans",
      href: `/projects/${projectId}/payment-plans`,
      label: t("paymentPlans.title"),
    },
    ...(can(access, "cost:read")
      ? [{ key: "costs", href: `/projects/${projectId}/costs`, label: t("costs.link") }]
      : []),
    ...(can(access, "construction:read")
      ? [
          {
            key: "construction",
            href: `/construction/${projectId}`,
            label: t("construction.projectLink"),
          },
        ]
      : []),
  ];
  return (
    <SegmentedNav
      label={t("inventory.projects.tabs.label")}
      segments={segments}
      current={current}
    />
  );
}
