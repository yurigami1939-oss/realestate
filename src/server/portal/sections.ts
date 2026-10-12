import "server-only";

import type { PortalSection } from "@/components/portal/portal-nav";

import type { PortalCtx } from "./context";
import { getPortalSections } from "./queries";

/** The portal's sections this account has, in the order of its navigation. */
export async function portalNavSections(ctx: PortalCtx): Promise<PortalSection[]> {
  const has = await getPortalSections(ctx);
  return [
    { key: "home", href: "/portal" },
    ...(has.buyer ? ([{ key: "documents", href: "/portal/documents" }] as const) : []),
    ...(has.payments ? ([{ key: "payments", href: "/portal/payments" }] as const) : []),
    ...(has.residences
      ? ([
          { key: "announcements", href: "/portal/announcements" },
          { key: "tickets", href: "/portal/tickets" },
          { key: "rooms", href: "/portal/rooms" },
          { key: "visitors", href: "/portal/visitors" },
        ] as const)
      : []),
    ...(has.coOwner ? ([{ key: "assemblies", href: "/portal/assemblies" }] as const) : []),
    { key: "notifications", href: "/portal/notifications" },
  ];
}
