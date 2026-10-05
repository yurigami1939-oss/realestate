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
  /**
   * Leads with their visits, follow-ups and timeline. `read` = the leads assigned to me,
   * `read_all` = every lead (managers); services apply the scope.
   */
  lead: ["read", "read_all", "create", "update", "assign", "merge", "delete"],
  /** Quotations (devis). Only managers may discount (CLAUDE.md §12). */
  quotation: ["create", "discount", "cancel"],
  /** Monthly activity targets of the commercials. */
  target: ["update"],
  /** Buyer files and their documents. `read` = buyers I follow, `read_all` = every buyer. */
  buyer: ["read", "read_all", "create", "update"],
  /**
   * Options, reservations, schedules and VSP. `read` = the sales I am the commercial of,
   * `read_all` = every sale. `update`: contracts, transfers, swaps, bank loans.
   * `withdraw` proposes a withdrawal, `approve` (gérant) approves it (CLAUDE.md §12).
   * `remind`: reminder letters for overdue installments.
   */
  sale: [
    "read",
    "read_all",
    "create",
    "update",
    "discount",
    "sign",
    "withdraw",
    "approve",
    "remind",
  ],
  /** Payments and receipts: cashiers record, accountants cancel (CLAUDE.md §5 roles). */
  payment: ["read", "create", "cancel"],
  /** Validating a construction milestone makes its installments due and issues payment calls. */
  milestone: ["validate"],
  /** `read` = my commissions, `read_all` = everyone's, `update` = mark paid / cancel. */
  commission: ["read", "read_all", "update"],
  /** Residences after delivery (module 6): setup, units' shares, co-owners and occupants. */
  residence: ["read", "create", "update"],
  /**
   * Charge categories, budgets and calls; `cancel` voids an issued call; `remind`: reminder
   * letters for overdue charges.
   */
  charge: ["read", "create", "cancel", "remind"],
  /** Suppliers, their contracts and invoices. */
  supplier: ["read", "update"],
  /** Residence staff, attendance, salary advances and pay. */
  staff: ["read", "update"],
  /** Maintenance tickets (réclamations). */
  ticket: ["read", "create", "update"],
  /** General assemblies: convocations, attendance, resolutions and votes. */
  assembly: ["read", "update"],
  /** Announcements to the residents of a residence (notices, portal). */
  announcement: ["read", "update"],
  /** Inviting buyers and co-owners / occupants to the portal (and withdrawing their access). */
  portal: ["invite"],
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
    lead: ["read", "read_all", "create", "update", "assign", "merge", "delete"],
    quotation: ["create", "discount", "cancel"],
    target: ["update"],
    buyer: ["read", "read_all", "create", "update"],
    sale: [
      "read",
      "read_all",
      "create",
      "update",
      "discount",
      "sign",
      "withdraw",
      "approve",
      "remind",
    ],
    payment: ["read", "create", "cancel"],
    milestone: ["validate"],
    commission: ["read", "read_all", "update"],
    residence: ["read", "create", "update"],
    charge: ["read", "create", "cancel", "remind"],
    supplier: ["read", "update"],
    staff: ["read", "update"],
    ticket: ["read", "create", "update"],
    assembly: ["read", "update"],
    announcement: ["read", "update"],
    portal: ["invite"],
  }),
  sales_manager: ac.newRole({
    inventory: ["read"],
    project: ["create", "update"],
    unit: ["create", "update", "delete", "block"],
    price: ["update"],
    lead: ["read", "read_all", "create", "update", "assign", "merge", "delete"],
    quotation: ["create", "discount", "cancel"],
    target: ["update"],
    buyer: ["read", "read_all", "create", "update"],
    sale: ["read", "read_all", "create", "update", "discount", "sign", "withdraw", "remind"],
    payment: ["read"],
    milestone: ["validate"],
    commission: ["read", "read_all"],
    portal: ["invite"],
  }),
  sales_agent: ac.newRole({
    inventory: ["read"],
    lead: ["read", "create", "update"],
    quotation: ["create"],
    buyer: ["read", "create", "update"],
    sale: ["read", "create"],
    commission: ["read"],
  }),
  accountant: ac.newRole({
    audit: ["read"],
    inventory: ["read"],
    buyer: ["read", "read_all"],
    sale: ["read", "read_all", "remind"],
    payment: ["read", "create", "cancel"],
    commission: ["read", "read_all", "update"],
    residence: ["read"],
    charge: ["read", "cancel", "remind"],
    supplier: ["read", "update"],
    staff: ["read", "update"],
  }),
  cashier: ac.newRole({
    inventory: ["read"],
    buyer: ["read", "read_all"],
    sale: ["read", "read_all", "remind"],
    payment: ["read", "create"],
    residence: ["read"],
    charge: ["read", "remind"],
  }),
  property_manager: ac.newRole({
    inventory: ["read"],
    payment: ["read", "create"],
    residence: ["read", "create", "update"],
    charge: ["read", "create", "remind"],
    supplier: ["read", "update"],
    staff: ["read", "update"],
    ticket: ["read", "create", "update"],
    assembly: ["read", "update"],
    announcement: ["read", "update"],
    portal: ["invite"],
  }),
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

/** A portal account (buyer, co-owner or occupant): no back-office role in this organization. */
export const isPortalOnly = (userRoles: readonly Role[]): boolean =>
  userRoles.length > 0 && userRoles.every((role) => role === "resident");

export function can(userRoles: readonly Role[], permission: Permission): boolean {
  const [resource, action] = permission.split(":") as [keyof Statement, string];
  return userRoles.some(
    (role) =>
      roles[role].authorize({ [resource]: [action] } as Parameters<
        (typeof roles)[Role]["authorize"]
      >[0]).success,
  );
}
