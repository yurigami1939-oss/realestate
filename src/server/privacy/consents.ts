import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { consentEvent, dataAccess, user } from "@/db/schema";
import { type TenantScope, withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { can } from "@/lib/permissions";
import type { AccessSubject, ConsentPurpose, ConsentSource, ConsentSubject } from "@/lib/privacy";
import type { TenantCtx } from "@/server/auth/session";

type Subject = { type: ConsentSubject; id: string };

/**
 * Records the consents that changed on a record (CLAUDE.md §7 Personal data): one append-only
 * event per purpose whose value differs from `before` (a new record: every consent given).
 */
export async function recordConsentChanges(
  tx: Tx,
  scope: TenantScope & { userId?: string | null },
  subject: Subject,
  before: Partial<Record<ConsentPurpose, boolean>> | null,
  after: Partial<Record<ConsentPurpose, boolean>>,
  source: ConsentSource = "staff",
  detail: string | null = null,
) {
  for (const [purpose, granted] of Object.entries(after) as [ConsentPurpose, boolean][]) {
    if ((before?.[purpose] ?? false) === granted) continue;
    await tx.insert(consentEvent).values({
      organizationId: scope.orgId,
      subjectType: subject.type,
      subjectId: subject.id,
      purpose,
      granted,
      source,
      detail,
      actorUserId: scope.userId ?? null,
    });
  }
}

/**
 * Logs that a member opened a person's file (one row per member, file and Algiers day; later
 * reads that day only count). Portal accounts reading their own file are not logged.
 */
export async function recordAccess(
  tx: Tx,
  ctx: TenantCtx,
  subjectType: AccessSubject,
  subjectId: string,
) {
  const now = new Date();
  await tx
    .insert(dataAccess)
    .values({
      organizationId: ctx.orgId,
      // In a support session, the operator reads (CLAUDE.console.md §12).
      userId: ctx.access?.supportBy?.id ?? ctx.userId,
      subjectType,
      subjectId,
      day: todayInAlgiers(),
      firstAt: now,
      lastAt: now,
    })
    .onConflictDoUpdate({
      target: [
        dataAccess.organizationId,
        dataAccess.subjectType,
        dataAccess.subjectId,
        dataAccess.userId,
        dataAccess.day,
      ],
      set: { lastAt: now, count: sql`${dataAccess.count} + 1` },
    });
}

/** A record's consent history, latest first. */
export async function consentHistory(tx: Tx, subject: Subject) {
  return tx
    .select({
      id: consentEvent.id,
      purpose: consentEvent.purpose,
      granted: consentEvent.granted,
      source: consentEvent.source,
      detail: consentEvent.detail,
      createdAt: consentEvent.createdAt,
      actorName: user.name,
    })
    .from(consentEvent)
    .leftJoin(user, eq(user.id, consentEvent.actorUserId))
    .where(and(eq(consentEvent.subjectType, subject.type), eq(consentEvent.subjectId, subject.id)))
    .orderBy(desc(consentEvent.createdAt));
}

/** Who opened a file, latest day first (at most the last 100 days of reads). */
export async function accessHistory(tx: Tx, subjectType: AccessSubject, subjectId: string) {
  return tx
    .select({
      id: dataAccess.id,
      day: dataAccess.day,
      firstAt: dataAccess.firstAt,
      lastAt: dataAccess.lastAt,
      count: dataAccess.count,
      userName: user.name,
    })
    .from(dataAccess)
    .innerJoin(user, eq(user.id, dataAccess.userId))
    .where(and(eq(dataAccess.subjectType, subjectType), eq(dataAccess.subjectId, subjectId)))
    .orderBy(desc(dataAccess.day), desc(dataAccess.lastAt))
    .limit(100);
}

/**
 * A person's consents and the reads of their file, for its page (`personal_data:export`:
 * gérant, directeur commercial); null for other members.
 */
export async function getPersonPrivacy(
  ctx: TenantCtx,
  subject: { type: ConsentSubject & AccessSubject; id: string },
) {
  if (!can(ctx, "personal_data:export")) return null;
  return withTenant(ctx, async (tx) => ({
    consents: await consentHistory(tx, subject),
    accesses: await accessHistory(tx, subject.type, subject.id),
  }));
}

export type PersonPrivacy = NonNullable<Awaited<ReturnType<typeof getPersonPrivacy>>>;
