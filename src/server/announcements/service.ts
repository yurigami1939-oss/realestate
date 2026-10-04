import "server-only";

import { eq } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { announcement } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadResidence } from "@/server/residences/service";

import type { createAnnouncementSchema, updateAnnouncementSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** An announcement of the organization (locked); NOT_FOUND otherwise. */
async function loadAnnouncement(tx: Tx, announcementId: string) {
  const [row] = await tx
    .select()
    .from(announcement)
    .where(eq(announcement.id, announcementId))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** A published announcement was printed and shown to residents: it no longer changes. */
function assertDraft(row: { publishedAt: Date | null }) {
  if (row.publishedAt) throw new AppError("CONFLICT", "announcements.errors.published");
}

/** New announcement of a residence, as a draft (announcement:update). */
export async function createAnnouncement(
  ctx: TenantCtx,
  input: In<typeof createAnnouncementSchema>,
) {
  assertCan(ctx, "announcement:update");
  const { residenceId, ...fields } = input;
  return withTenant(ctx, async (tx) => {
    const home = await loadResidence(tx, residenceId);
    const [row] = await tx
      .insert(announcement)
      .values({ ...fields, organizationId: ctx.orgId, residenceId: home.id, createdBy: ctx.userId })
      .returning({ id: announcement.id });
    if (!row) throw new Error("createAnnouncement: no row returned");
    return { id: row.id };
  });
}

export async function updateAnnouncement(
  ctx: TenantCtx,
  input: In<typeof updateAnnouncementSchema>,
) {
  assertCan(ctx, "announcement:update");
  const { announcementId, ...fields } = input;
  await withTenant(ctx, async (tx) => {
    assertDraft(await loadAnnouncement(tx, announcementId));
    await tx.update(announcement).set(fields).where(eq(announcement.id, announcementId));
  });
}

/** Deletes a draft (it was never shown to anyone); published ones are withdrawn instead. */
export async function deleteAnnouncement(ctx: TenantCtx, announcementId: string) {
  assertCan(ctx, "announcement:update");
  await withTenant(ctx, async (tx) => {
    assertDraft(await loadAnnouncement(tx, announcementId));
    await tx.delete(announcement).where(eq(announcement.id, announcementId));
  });
}

/**
 * Publishes a draft: from now on residents see it (portal) until its expiry day or its
 * withdrawal, and the bilingual notice to post in the building is rendered by the worker.
 */
export async function publishAnnouncement(ctx: TenantCtx, announcementId: string) {
  assertCan(ctx, "announcement:update");
  await withTenant(ctx, async (tx) => {
    const row = await loadAnnouncement(tx, announcementId);
    assertDraft(row);
    if (row.expiresOn && row.expiresOn < todayInAlgiers()) {
      throw invalid("expiresOn", "announcements.errors.expiresPast");
    }
    await tx
      .update(announcement)
      .set({ publishedAt: new Date(), publishedBy: ctx.userId })
      .where(eq(announcement.id, row.id));
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "announcement", id: row.id },
      { singletonKey: `announcement:${row.id}` },
    );
  });
}

/** Withdraws a published announcement: residents no longer see it; it stays in the history. */
export async function archiveAnnouncement(ctx: TenantCtx, announcementId: string) {
  assertCan(ctx, "announcement:update");
  await withTenant(ctx, async (tx) => {
    const row = await loadAnnouncement(tx, announcementId);
    if (!row.publishedAt) throw new AppError("CONFLICT", "announcements.errors.notPublished");
    if (row.archivedAt) throw new AppError("CONFLICT", "announcements.errors.archived");
    await tx
      .update(announcement)
      .set({ archivedAt: new Date(), archivedBy: ctx.userId })
      .where(eq(announcement.id, row.id));
  });
}
