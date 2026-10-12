import "server-only";

import { DEMO_PASSWORD, demoUsers } from "@/db/seed/demo";
import { env } from "@/env";
import type { Role } from "@/lib/permissions";

/**
 * The public demo deployment (DEMO_MODE, CLAUDE.console.md §13): the seed's fictitious data,
 * reset every night, open to prospects.
 */
export const demoModeEnabled = (): boolean => env.DEMO_MODE === true;

export type DemoAccount = { email: string; name: string; role: Role };

/**
 * The demo accounts the sign-in page offers (one per role, the portal's buyer last) and their
 * shared password; none outside the demo.
 */
export function demoSignIn(): { password: string; accounts: DemoAccount[] } | null {
  if (!demoModeEnabled()) return null;
  return {
    password: DEMO_PASSWORD,
    accounts: demoUsers
      .filter((u) => u.key !== "salesAgent2")
      .map((u) => ({ email: u.email, name: u.name, role: u.roles[0] })),
  };
}
