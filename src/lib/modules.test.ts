import { describe, expect, it } from "vitest";

import {
  dependantsOf,
  effectiveModules,
  modules,
  resourceAllowed,
  resourceModule,
} from "./modules";
import { can, statement } from "./permissions";

describe("modules (CLAUDE.console.md §5)", () => {
  it("maps every permission resource to a module, the core or the shared suppliers", () => {
    for (const resource of Object.keys(statement)) {
      expect(resourceModule, resource).toHaveProperty(resource);
    }
    const owners = new Set(Object.values(resourceModule));
    for (const owner of owners) {
      expect(["core", "shared", ...modules]).toContain(owner);
    }
  });

  it("keeps a module on only when entitled, not switched off, with its prerequisites", () => {
    expect(effectiveModules(["portal", "online_payment", "treasury"], [])).toEqual([
      "treasury",
      "portal",
      "online_payment",
    ]);
    expect(effectiveModules(["portal", "online_payment"], ["portal"])).toEqual([]);
    expect(effectiveModules(["online_payment"], [])).toEqual([]);
    expect(effectiveModules(["treasury", "nonsense"], ["reports"])).toEqual(["treasury"]);
    expect(dependantsOf("portal")).toEqual(["online_payment"]);
  });

  it("allows a resource by its module; the suppliers with any module using them", () => {
    expect(resourceAllowed("sale", [])).toBe(true);
    expect(resourceAllowed("treasury", [])).toBe(false);
    expect(resourceAllowed("treasury", ["treasury"])).toBe(true);
    expect(resourceAllowed("supplier", ["costs"])).toBe(true);
    expect(resourceAllowed("supplier", ["reports"])).toBe(false);
    expect(resourceAllowed("treasury", null)).toBe(true);
  });

  it("refuses a permission of a module that is off, whatever the role or custom role", () => {
    expect(can({ roles: ["owner"], modules: ["reports"] }, "treasury:read")).toBe(false);
    expect(can({ roles: ["owner"], modules: ["treasury"] }, "treasury:read")).toBe(true);
    expect(
      can({ roles: ["sales_agent"], permissions: ["lease:read"], modules: [] }, "lease:read"),
    ).toBe(false);
    expect(can({ roles: ["owner"], access: { modules: [] } }, "residence:read")).toBe(false);
    expect(can({ roles: ["owner"], access: { modules: [] } }, "sale:read")).toBe(true);
    expect(can(["owner"], "treasury:read")).toBe(true);
  });
});
