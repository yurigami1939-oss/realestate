import "server-only";

import { sql } from "drizzle-orm";

import { db, type Tx } from "@/db/client";
import { user } from "@/db/schema";

import { OPERATOR_ROLE } from "./schema-options";

/**
 * Whether an e-mail belongs to an operator of the platform (CLAUDE.console.md §9): operators
 * are never invited into an organization, as staff or to the portal.
 */
export async function isOperatorEmail(email: string, tx?: Tx): Promise<boolean> {
  const rows = await (tx ?? db)
    .select({ role: user.role })
    .from(user)
    .where(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`);
  return rows.some((r) => r.role === OPERATOR_ROLE);
}
