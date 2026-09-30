import { randomUUID } from "node:crypto";

import { db } from "@/db/client";
import { organization, user } from "@/db/schema";

const suffix = () => randomUUID().slice(0, 8);

/** A fresh organization per test keeps tests isolated without truncating tables. */
export async function createOrganization(values: Partial<typeof organization.$inferInsert> = {}) {
  const s = suffix();
  const [row] = await db
    .insert(organization)
    .values({ name: `Promotion ${s}`, slug: `promo-${s}`, createdAt: new Date(), ...values })
    .returning();
  if (!row) throw new Error("createOrganization: no row returned");
  return row;
}

export async function createUser(values: Partial<typeof user.$inferInsert> = {}) {
  const s = suffix();
  const [row] = await db
    .insert(user)
    .values({ name: `User ${s}`, email: `user-${s}@example.test`, ...values })
    .returning();
  if (!row) throw new Error("createUser: no row returned");
  return row;
}
