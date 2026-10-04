import { describe, expect, it } from "vitest";

import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createResidenceSchema } from "@/server/residences/schemas";
import { createResidence } from "@/server/residences/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { loadNoticeData, noticeHtml, renderAndStoreNotice } from "./documents";
import { listAnnouncements } from "./queries";
import { createAnnouncementSchema, updateAnnouncementSchema } from "./schemas";
import {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  publishAnnouncement,
  updateAnnouncement,
} from "./service";

const today = todayInAlgiers();

async function scenario() {
  const team = await createSalesTeam();
  const { projectId } = await createSaleSetup(team);
  const manager = await addMember(team.orgId, ["property_manager"]);
  const { id: residenceId } = await createResidence(
    manager,
    createResidenceSchema.parse({
      projectId,
      name: "Résidence Les Oliviers",
      shareBasis: "10000",
      chargeFrequency: "quarterly",
      reserveFund: "0",
      callDueDays: "30",
    }),
  );
  return { team, manager, residenceId };
}

const fields = {
  category: "outage",
  title: "Coupure d'eau jeudi",
  titleAr: "انقطاع الماء يوم الخميس",
  body: "L'eau sera coupée de 9 h à 12 h pour le nettoyage de la bâche.",
  bodyAr: "سيُقطع الماء من الساعة 9 إلى الساعة 12 لتنظيف الخزان.",
  expiresOn: addDays(today, 7),
  pinned: true,
};

describe("announcements", () => {
  it("are drafted, published once with a bilingual notice, then withdrawn", async () => {
    const { team, manager, residenceId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const other = await scenario();
    const input = (overrides: Record<string, unknown> = {}) =>
      createAnnouncementSchema.parse({ residenceId, ...fields, ...overrides });

    await expect(createAnnouncement(cashier, input())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(listAnnouncements(cashier, residenceId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { id } = await createAnnouncement(manager, input({ title: "Coupure d'eau" }));
    expect(await listAnnouncements(other.manager, residenceId)).toEqual([]);
    await updateAnnouncement(
      manager,
      updateAnnouncementSchema.parse({ announcementId: id, ...fields }),
    );

    // A draft can be dropped; an expiry already past cannot be published.
    const { id: dropped } = await createAnnouncement(manager, input({ title: "Brouillon" }));
    await deleteAnnouncement(manager, dropped);
    const { id: stale } = await createAnnouncement(
      manager,
      input({ title: "Réunion passée", category: "meeting", expiresOn: addDays(today, -1) }),
    );
    await expect(publishAnnouncement(manager, stale)).rejects.toMatchObject({
      messageKey: "announcements.errors.expiresPast",
    });
    await expect(archiveAnnouncement(manager, id)).rejects.toMatchObject({
      messageKey: "announcements.errors.notPublished",
    });

    await publishAnnouncement(manager, id);
    const published = { messageKey: "announcements.errors.published" };
    await expect(publishAnnouncement(manager, id)).rejects.toMatchObject(published);
    await expect(
      updateAnnouncement(
        manager,
        updateAnnouncementSchema.parse({ announcementId: id, ...fields }),
      ),
    ).rejects.toMatchObject(published);
    await expect(deleteAnnouncement(manager, id)).rejects.toMatchObject(published);
    const list = await listAnnouncements(manager, residenceId);
    expect(list.map((a) => [a.title, a.state])).toEqual([
      ["Coupure d'eau jeudi", "published"],
      ["Réunion passée", "draft"],
    ]);
    expect(list[0]?.publishedByName).not.toBeNull();

    // The notice to post in the building, rendered once.
    const loaded = await withTenant(team.owner, (tx) => loadNoticeData(tx, id));
    if (!loaded) throw new Error("notice not found");
    expect(loaded.data).toMatchObject({
      residenceName: "Résidence Les Oliviers",
      category: "outage",
      titleAr: "انقطاع الماء يوم الخميس",
      expiresOn: fields.expiresOn,
    });
    const html = noticeHtml(loaded.data, {
      name: "Promo",
      legalName: "SARL Promo",
      address: null,
      wilaya: null,
      phone: null,
      rcNumber: null,
      nif: null,
      nis: null,
      aiNumber: null,
      logo: null,
    });
    expect(html).toContain("AVIS AUX RÉSIDENTS");
    expect(html).toContain("إعلان إلى السكان");
    expect(html).toContain("سيُقطع الماء");
    expect(await renderAndStoreNotice(team.orgId, id)).toBe("stored");
    expect(await renderAndStoreNotice(team.orgId, id)).toBe("skipped");
    expect(await withTenant(team.owner, (tx) => loadNoticeData(tx, stale))).toBeNull();

    await archiveAnnouncement(manager, id);
    await expect(archiveAnnouncement(manager, id)).rejects.toMatchObject({
      messageKey: "announcements.errors.archived",
    });
    const after = await listAnnouncements(manager, residenceId);
    expect(after.map((a) => [a.title, a.state])).toEqual([
      ["Réunion passée", "draft"],
      ["Coupure d'eau jeudi", "archived"],
    ]);
    expect(after[1]?.pdfFileId).not.toBeNull();
  });
});
