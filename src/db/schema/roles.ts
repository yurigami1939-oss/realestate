import { sql } from "drizzle-orm";
import { foreignKey, index, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { Permission } from "../../lib/permissions";

import { id, instant, organizationId, timestamps, userRef } from "./_columns";

/**
 * A role an organization defines for itself (CLAUDE.md §5 Auth & roles): a name, the built-in
 * staff role it starts from (kept as the member's Better Auth role) and the exact permissions
 * its members hold. Archived, never deleted.
 */
export const customRole = pgTable(
  "custom_role",
  {
    id: id(),
    organizationId: organizationId(),
    name: text().notNull(),
    baseRole: text().notNull(),
    permissions: text()
      .array()
      .$type<Permission[]>()
      .notNull()
      .default(sql`'{}'`),
    archivedAt: instant(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    uniqueIndex("custom_role_name")
      .on(t.organizationId, t.name)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/** The custom role a member holds (at most one per organization). */
export const memberCustomRole = pgTable(
  "member_custom_role",
  {
    id: id(),
    organizationId: organizationId(),
    userId: userRef().notNull(),
    customRoleId: uuid().notNull(),
    assignedBy: userRef(),
    assignedAt: instant().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("member_custom_role_member").on(t.organizationId, t.userId),
    index().on(t.organizationId, t.customRoleId),
    foreignKey({
      name: "member_custom_role_role_fk",
      columns: [t.organizationId, t.customRoleId],
      foreignColumns: [customRole.organizationId, customRole.id],
    }),
  ],
);
