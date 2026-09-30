import "server-only";

import { eq } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { lead, leadActivity } from "@/db/schema";
import type { LeadActivityType } from "@/lib/crm";

type Actor = { orgId: string; userId: string | null };
type Data = Record<string, string | number | boolean | null>;

/** Appends to the lead's timeline and bumps its last activity (same transaction as the change). */
export async function recordLeadActivity(
  tx: Tx,
  actor: Actor,
  leadId: string,
  type: LeadActivityType,
  data: Data | null = null,
) {
  await tx.insert(leadActivity).values({
    organizationId: actor.orgId,
    leadId,
    type,
    actorUserId: actor.userId,
    data,
  });
  await tx.update(lead).set({ lastActivityAt: new Date() }).where(eq(lead.id, leadId));
}
