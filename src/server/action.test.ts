import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type * as Session from "./auth/session";
import type { TenantCtx } from "./auth/session";
import type { TenantAccess } from "./entitlements/access";

const current = vi.hoisted(() => ({ ctx: null as TenantCtx | null }));
vi.mock("./auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof Session>()),
  getTenantCtx: async () => current.ctx,
}));

const { defineAction } = await import("./action");

const access = (over: Partial<TenantAccess>): TenantAccess => ({
  status: "active",
  modules: [],
  entitled: [],
  disabled: [],
  limits: null,
  pilotEndsOn: null,
  currentPeriodEnd: null,
  readOnly: false,
  supportBy: null,
  ...over,
});
const ctxWith = (over: Partial<TenantAccess>): TenantCtx => ({
  userId: "00000000-0000-4000-8000-000000000001",
  orgId: "00000000-0000-4000-8000-000000000002",
  roles: ["owner"],
  locale: "fr",
  access: access(over),
});

describe("defineAction and read-only organizations (CLAUDE.console.md §6, §12)", () => {
  const settle = defineAction(
    { input: z.object({}), allowWhenReadOnly: true },
    async () => "settled",
  );
  const change = defineAction({ input: z.object({}) }, async () => "changed");

  it("lets the allowlisted actions settle money while suspended, never other changes", async () => {
    current.ctx = ctxWith({ status: "suspended", readOnly: true });
    expect(await settle({})).toEqual({ ok: true, data: "settled" });
    expect(await change({})).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", messageKey: "errors.readOnly.suspended" },
    });
  });

  it("refuses even the allowlisted actions during a support session", async () => {
    current.ctx = ctxWith({ readOnly: true, supportBy: { id: "op", name: "Opératrice" } });
    expect(await settle({})).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", messageKey: "errors.readOnly.support" },
    });
  });
});
