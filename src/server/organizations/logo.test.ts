import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, file } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { paymentCallHtml } from "@/server/payment-calls/documents";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { getFileDownloadUrl } from "../files/service";

import {
  getCompanySettings,
  loadCompanyLetterhead,
  removeCompanyLogo,
  setCompanyLogo,
} from "./settings";

/** A 1×1 PNG. */
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const pdf = new TextEncoder().encode("%PDF-1.7\nlogo\n%%EOF");

describe("company logo", () => {
  it("is set by the gérant only, as PNG or JPEG, and replaced cleanly", async () => {
    const team = await createSalesTeam();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const upload = (bytes: Uint8Array, fileName = "logo.png") => ({ upload: { fileName, bytes } });

    await expect(setCompanyLogo(team.manager, upload(PNG))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(setCompanyLogo(team.owner, upload(pdf, "logo.pdf"))).rejects.toMatchObject({
      messageKey: "files.errors.type",
    });
    await expect(
      setCompanyLogo(team.owner, upload(new Uint8Array(3 * 1024 * 1024).fill(0x89))),
    ).rejects.toMatchObject({ messageKey: "files.errors.tooLarge" });

    const first = await setCompanyLogo(team.owner, upload(PNG, "ancien.png"));
    const second = await setCompanyLogo(team.owner, upload(PNG, "nouveau.png"));
    expect((await getCompanySettings(team.owner)).logoFileId).toBe(second.fileId);
    const [old] = await withTenant(team.owner, (tx) =>
      tx.select({ deletedAt: file.deletedAt }).from(file).where(eq(file.id, first.fileId)),
    );
    expect(old?.deletedAt).toBeInstanceOf(Date);

    // Any member may display it (documents, settings page).
    await expect(getFileDownloadUrl(cashier, second.fileId, "inline")).resolves.toMatch(/^http/);

    const letterhead = await withTenant(team.owner, (tx) => loadCompanyLetterhead(tx, team.orgId));
    expect(letterhead.logo).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    const html = paymentCallHtml(
      {
        number: "ADF-2026-000001",
        issuedAt: new Date("2026-10-01T09:00:00Z"),
        saleNumber: "RES-2026-000001",
        saleDeedNumber: null,
        projectName: "Résidence Les Oliviers",
        buildingName: "Bloc A",
        unitCode: "A-03-01",
        milestoneName: "Fondations",
        validatedOn: "2026-10-01",
        label: "Fondations",
        amount: 100n,
        settled: 0n,
        called: 100n,
        dueOn: "2026-10-16",
        buyers: [],
      },
      letterhead,
    );
    expect(html).toContain('<img src="data:image/png;base64,');

    await removeCompanyLogo(team.owner);
    expect((await getCompanySettings(team.owner)).logoFileId).toBeNull();
    expect(
      (await withTenant(team.owner, (tx) => loadCompanyLetterhead(tx, team.orgId))).logo,
    ).toBeNull();
    const audit = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, team.orgId), eq(auditLog.action, "organization.logo"))),
    );
    expect(audit).toHaveLength(3);
  });

  it("stays within its organization", async () => {
    const team = await createSalesTeam();
    const other = await createSalesTeam();
    const { fileId } = await setCompanyLogo(team.owner, {
      upload: { fileName: "logo.png", bytes: PNG },
    });
    await expect(getFileDownloadUrl(other.owner, fileId, "inline")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
