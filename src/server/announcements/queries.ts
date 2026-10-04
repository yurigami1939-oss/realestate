import "server-only";

import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { announcement, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { type AnnouncementState, announcementState } from "@/lib/announcements";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";

const publisher = alias(user, "publisher");

/** Shown first: what residents see now, then drafts, then the history. */
const stateRank: Record<AnnouncementState, number> = {
  published: 0,
  draft: 1,
  expired: 2,
  archived: 3,
};

/**
 * Announcements of a residence with their derived state: current ones first (pinned on top,
 * newest first), then drafts, expired and withdrawn ones.
 */
export async function listAnnouncements(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "announcement:read");
  if (!isUuid(residenceId)) return [];
  const today = todayInAlgiers();
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({
        id: announcement.id,
        category: announcement.category,
        title: announcement.title,
        titleAr: announcement.titleAr,
        body: announcement.body,
        bodyAr: announcement.bodyAr,
        expiresOn: announcement.expiresOn,
        pinned: announcement.pinned,
        publishedAt: announcement.publishedAt,
        publishedByName: publisher.name,
        archivedAt: announcement.archivedAt,
        pdfFileId: announcement.pdfFileId,
        createdAt: announcement.createdAt,
      })
      .from(announcement)
      .leftJoin(publisher, eq(publisher.id, announcement.publishedBy))
      .where(eq(announcement.residenceId, residenceId))
      .orderBy(desc(announcement.publishedAt), desc(announcement.createdAt)),
  );
  return rows
    .map((row) => ({ ...row, state: announcementState(row, today) }))
    .sort(
      (a, b) =>
        stateRank[a.state] - stateRank[b.state] ||
        (a.state === "published" ? Number(b.pinned) - Number(a.pinned) : 0),
    );
}

export type AnnouncementRow = Awaited<ReturnType<typeof listAnnouncements>>[number];
