/** Flags of the demo deployment's nightly reset (CLAUDE.console.md §13). */
export type ResetFlags = Readonly<Record<string, string | undefined>>;

const localHosts = ["localhost", "127.0.0.1", "::1", "postgres"];

/** True for the demo deployment's reset: both DEMO_MODE=true and DEMO_RESET=1. */
export const isDemoReset = (flags: ResetFlags): boolean =>
  flags.DEMO_MODE === "true" && flags.DEMO_RESET === "1";

/**
 * Refuses anything but a local database: seeding wipes data. The demo deployment's own
 * database is accepted only with both demo flags set.
 */
export function assertLocalDatabase(url: string, flags: ResetFlags = process.env): void {
  const host = new URL(url).hostname;
  if (localHosts.includes(host) || isDemoReset(flags)) return;
  throw new Error(`Refusing to seed/reset a non-local database (${host}).`);
}
