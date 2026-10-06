import { randomUUID } from "node:crypto";

import { db } from "@/db/client";
import { member, organization, user } from "@/db/schema";
import type { Role } from "@/lib/permissions";
import type { TenantCtx } from "@/server/auth/session";

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

/** A fresh organization and user, as the TenantCtx a service receives. */
export async function createTenantCtx(roles: Role[] = ["owner"]): Promise<TenantCtx> {
  const org = await createOrganization();
  const member = await createUser();
  return { orgId: org.id, userId: member.id, roles, locale: "fr" };
}

/** Adds a member with these roles to the organization and returns their TenantCtx. */
export async function addMember(orgId: string, roles: Role[]): Promise<TenantCtx> {
  const created = await createUser();
  await db.insert(member).values({
    organizationId: orgId,
    userId: created.id,
    role: roles.join(","),
    createdAt: new Date(),
  });
  return { orgId, userId: created.id, roles, locale: "fr" };
}

/** A fresh organization with a gérant, a directeur commercial and two commercials (all members). */
export async function createSalesTeam() {
  const org = await createOrganization();
  const [owner, manager, agentA, agentB] = await Promise.all([
    addMember(org.id, ["owner"]),
    addMember(org.id, ["sales_manager"]),
    addMember(org.id, ["sales_agent"]),
    addMember(org.id, ["sales_agent"]),
  ]);
  return { orgId: org.id, owner, manager, agentA, agentB };
}

/** Raw company settings form input (all fields), for `companySettingsSchema.parse`. */
export const companySettingsInput = (overrides: Record<string, string> = {}) => ({
  name: "El Bahdja",
  quotationValidityDays: "15",
  optionHours: "24",
  paymentCallDelayDays: "15",
  withdrawalRetention: "10",
  penaltyMonthlyRate: "0",
  penaltyGraceDays: "0",
  penaltyCap: "10",
  defaultCommissionRate: "0",
  deliveryPenaltyMonthlyRate: "0",
  deliveryPenaltyCap: "10",
  formalNoticeDays: "15",
  formalNoticesRequired: "2",
  terminationRetention: "10",
  fgcmpiNumber: "",
  ...overrides,
});
