import { describe, expect, it } from "vitest";

import { can, parseRoles } from "./permissions";

describe("permissions", () => {
  it("parses Better Auth multi-role strings and drops unknown roles", () => {
    expect(parseRoles("accountant, cashier")).toEqual(["accountant", "cashier"]);
    expect(parseRoles("admin,owner")).toEqual(["owner"]);
    expect(parseRoles(null)).toEqual([]);
  });

  it("gives the owner member management and audit access", () => {
    expect(can(["owner"], "invitation:create")).toBe(true);
    expect(can(["owner"], "member:delete")).toBe(true);
    expect(can(["owner"], "audit:read")).toBe(true);
  });

  it("denies member management to other roles", () => {
    for (const role of [
      "sales_manager",
      "sales_agent",
      "accountant",
      "cashier",
      "technical_manager",
      "resident",
    ] as const) {
      expect(can([role], "invitation:create"), role).toBe(false);
    }
  });

  it("gives the residence module to the property manager, finance to the accountant", () => {
    expect(can(["property_manager"], "residence:create")).toBe(true);
    expect(can(["property_manager"], "charge:create")).toBe(true);
    expect(can(["property_manager"], "charge:cancel")).toBe(false);
    expect(can(["property_manager"], "payment:create")).toBe(true);
    expect(can(["property_manager"], "payment:cancel")).toBe(false);
    expect(can(["accountant"], "charge:cancel")).toBe(true);
    expect(can(["accountant"], "residence:update")).toBe(false);
    expect(can(["cashier"], "charge:read")).toBe(true);
    expect(can(["sales_manager"], "residence:read")).toBe(false);
    expect(can(["owner"], "assembly:update")).toBe(true);
  });

  it("gives the responsable technique the works and deliveries, not sales or money", () => {
    expect(can(["technical_manager"], "construction:update")).toBe(true);
    expect(can(["technical_manager"], "handover:update")).toBe(true);
    expect(can(["technical_manager"], "inventory:read")).toBe(true);
    expect(can(["technical_manager"], "sale:read")).toBe(false);
    expect(can(["technical_manager"], "payment:read")).toBe(false);
    expect(can(["sales_manager"], "construction:update")).toBe(false);
    expect(can(["sales_manager"], "handover:update")).toBe(true);
    expect(can(["sales_agent"], "construction:read")).toBe(true);
    expect(can(["sales_agent"], "handover:read")).toBe(false);
    expect(can(["property_manager"], "handover:read")).toBe(true);
    expect(can(["property_manager"], "handover:update")).toBe(false);
  });

  it("grants the union of several roles", () => {
    expect(can(["cashier"], "audit:read")).toBe(false);
    expect(can(["cashier", "accountant"], "audit:read")).toBe(true);
  });

  it("scopes CRM access: commercials work their leads, managers everything", () => {
    expect(can(["sales_agent"], "lead:read")).toBe(true);
    expect(can(["sales_agent"], "lead:read_all")).toBe(false);
    expect(can(["sales_agent"], "lead:assign")).toBe(false);
    expect(can(["sales_agent"], "quotation:discount")).toBe(false);
    expect(can(["sales_manager"], "lead:merge")).toBe(true);
    expect(can(["sales_manager"], "quotation:discount")).toBe(true);
    expect(can(["cashier"], "lead:read")).toBe(false);
  });
});
