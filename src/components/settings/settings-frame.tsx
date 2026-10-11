import { accessOf } from "@/lib/permissions";
import { requireTenantCtx } from "@/server/auth/page-guard";

import { SettingsNav } from "./settings-nav";

/** The frame of the settings hub's pages: its navigation beside the page. */
export async function SettingsFrame({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenantCtx();
  return (
    <div className="lg:flex lg:gap-10">
      <SettingsNav access={accessOf(ctx)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
