import { describe, expect, it } from "vitest";

import { canTransition, entitlementFor, isWritable, unlimited } from "./subscriptions";

describe("entitlementFor", () => {
  it("joins the plan's and the add-ons' modules in catalog order, once each", () => {
    const { modules } = entitlementFor({
      planModules: ["portal", "imports", "treasury"],
      addonModules: ["syndic", "portal", "rentals"],
      limits: unlimited,
      overrides: {},
    });
    expect(modules).toEqual(["imports", "treasury", "portal", "syndic", "rentals"]);
  });

  it("drops modules the catalog does not know", () => {
    const { modules } = entitlementFor({
      planModules: ["imports", "teleportation"],
      addonModules: [],
      limits: unlimited,
      overrides: {},
    });
    expect(modules).toEqual(["imports"]);
  });

  it("applies the subscription's cap overrides over the plan's caps", () => {
    const { limits } = entitlementFor({
      planModules: [],
      addonModules: [],
      limits: { activeUnits: 300, organizations: 2, storageGb: 100 },
      overrides: { activeUnits: 450, storageGb: null },
    });
    expect(limits).toEqual({ activeUnits: 450, organizations: 2, storageGb: null });
  });
});

describe("subscription transitions", () => {
  it("lets the job move pilots and invoices, the operator suspend and terminate", () => {
    expect(canTransition("pilot", "past_due")).toBe(true);
    expect(canTransition("past_due", "active")).toBe(true);
    expect(canTransition("active", "suspended")).toBe(true);
    expect(canTransition("terminated", "suspended")).toBe(true);
    expect(canTransition("terminated", "active")).toBe(false);
    expect(canTransition("suspended", "past_due")).toBe(false);
  });

  it("keeps an organization writable unless suspended, terminated or unsubscribed", () => {
    expect(isWritable("pilot")).toBe(true);
    expect(isWritable("past_due")).toBe(true);
    expect(isWritable("suspended")).toBe(false);
    expect(isWritable("terminated")).toBe(false);
    expect(isWritable(null)).toBe(false);
  });
});
