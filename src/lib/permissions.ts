/**
 * Roles and permissions (CLAUDE.md §5 Auth & roles). Isomorphic: the server enforces with
 * `assertCan` (src/server/auth/session.ts), the UI only hides controls with `can`.
 * Each module adds its resources here as it lands.
 */
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, ownerAc } from "better-auth/plugins/organization/access";

export const statement = {
  ...defaultStatements,
  audit: ["read"],
  /** Read projects, buildings, units, prices and price lists. */
  inventory: ["read"],
  /** Projects and their buildings. */
  project: ["create", "update", "delete"],
  unit: ["create", "update", "delete", "block"],
  /** Unit list prices and price lists. */
  price: ["update"],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    audit: ["read"],
    inventory: ["read"],
    project: ["create", "update", "delete"],
    unit: ["create", "update", "delete", "block"],
    price: ["update"],
  }),
  sales_manager: ac.newRole({
    inventory: ["read"],
    project: ["create", "update"],
    unit: ["create", "update", "delete", "block"],
    price: ["update"],
  }),
  sales_agent: ac.newRole({ inventory: ["read"] }),
  accountant: ac.newRole({ audit: ["read"], inventory: ["read"] }),
  cashier: ac.newRole({ inventory: ["read"] }),
  property_manager: ac.newRole({ inventory: ["read"] }),
  resident: ac.newRole({}),
};

export type Role = keyof typeof roles;

export const roleNames = Object.keys(roles) as Role[];

/** Roles that can be granted through an invitation (owner is only the organization creator). */
export const invitableRoles = [
  "sales_manager",
  "sales_agent",
  "accountant",
  "cashier",
  "property_manager",
  "resident",
] as const satisfies readonly Exclude<Role, "owner">[];

export type InvitableRole = (typeof invitableRoles)[number];

type Statement = typeof statement;
export type Permission = {
  [R in keyof Statement]: `${R & string}:${Statement[R][number]}`;
}[keyof Statement];

export const isRole = (value: string): value is Role => value in roles;

/** Better Auth stores several roles as "accountant,cashier". Unknown names are dropped. */
export function parseRoles(value: string | null | undefined): Role[] {
  return (value ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(isRole);
}

export function can(userRoles: readonly Role[], permission: Permission): boolean {
  const [resource, action] = permission.split(":") as [keyof Statement, string];
  return userRoles.some(
    (role) =>
      roles[role].authorize({ [resource]: [action] } as Parameters<
        (typeof roles)[Role]["authorize"]
      >[0]).success,
  );
}
