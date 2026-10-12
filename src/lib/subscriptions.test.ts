import { describe, expect, it } from "vitest";

import { entitlementFor, unlimited } from "./subscriptions";

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
