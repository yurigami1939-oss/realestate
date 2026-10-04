import "server-only";

import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import { announcement, residence } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { toCalendarDate } from "@/lib/dates";
import { renderPdf } from "@/pdf/render";
import {
  type AnnouncementNoticeData,
  AnnouncementNoticeTemplate,
} from "@/pdf/templates/announcement-notice";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

/** Everything printed on a published announcement's notice (null if unknown or a draft). */
export async function loadNoticeData(
  tx: Tx,
  announcementId: string,
): Promise<{ data: AnnouncementNoticeData; fileId: string | null; residenceId: string } | null> {
  const [row] = await tx
    .select({
      announcement,
      residenceName: residence.name,
      address: residence.address,
      commune: residence.commune,
      wilaya: residence.wilaya,
    })
    .from(announcement)
    .innerJoin(residence, eq(residence.id, announcement.residenceId))
    .where(eq(announcement.id, announcementId));
  const a = row?.announcement;
  if (!row || !a?.publishedAt) return null;
  return {
    fileId: a.pdfFileId,
    residenceId: a.residenceId,
    data: {
      residenceName: row.residenceName,
      residenceAddress: [row.address, row.commune, row.wilaya].filter(Boolean).join(", "),
      category: a.category,
      title: a.title,
      titleAr: a.titleAr,
      body: a.body,
      bodyAr: a.bodyAr,
      publishedAt: a.publishedAt,
      expiresOn: a.expiresOn,
    },
  };
}

export function noticeHtml(data: AnnouncementNoticeData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(AnnouncementNoticeTemplate, { data, company }),
  )}`;
}

/** `pdf.document` (announcement): the notice, rendered once at publication, filed under the residence. */
export async function renderAndStoreNotice(
  organizationId: string,
  announcementId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const notice = await loadNoticeData(tx, announcementId);
    if (!notice || notice.fileId) return null;
    return { notice, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const { data, residenceId } = loaded.notice;
  const bytes = new Uint8Array(await renderPdf(noticeHtml(data, loaded.company)));
  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ fileId: announcement.pdfFileId })
      .from(announcement)
      .where(eq(announcement.id, announcementId))
      .for("update");
    if (!current || current.fileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        entityType: "residence",
        entityId: residenceId,
        upload: { fileName: `avis-${toCalendarDate(data.publishedAt)}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(announcement)
      .set({ pdfFileId: stored.id })
      .where(eq(announcement.id, announcementId));
    return "stored";
  });
}
