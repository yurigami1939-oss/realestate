import { describe, expect, it } from "vitest";

import type { TenantCtx } from "@/server/auth/session";
import { createLead } from "@/server/crm/leads";
import { createLeadSchema } from "@/server/crm/schemas";
import { getFileDownloadUrl } from "@/server/files/service";

import { addMember, createSalesTeam } from "../../../tests/factories";

import { getBuyer, listBuyers } from "./queries";
import { createBuyerSchema, setBuyerDocumentSchema, updateBuyerSchema } from "./schemas";
import { createBuyer, setBuyerDocument, setBuyerDocumentScan, updateBuyer } from "./service";

const rawBuyer = {
  civility: "mr",
  lastName: "Bensalem",
  firstName: "Karim",
  lastNameAr: "بن سالم",
  firstNameAr: "كريم",
  birthDate: "1985-04-12",
  nin: "1090 8519 8500 1234 56",
  phone: "0550 12 34 56",
};

const newLead = async (ctx: TenantCtx) =>
  (
    await createLead(
      ctx,
      createLeadSchema.parse({
        fullName: "Karim Bensalem",
        phone: "0550 12 34 56",
        source: "walk_in",
        typologies: [],
      }),
    )
  ).id;

const pdf = () => new TextEncoder().encode("%PDF-1.7\nscan\n%%EOF");

describe("buyers", () => {
  it("are followed by the lead's commercial and scoped like leads", async () => {
    const { orgId, manager, agentA, agentB } = await createSalesTeam();
    const cashier = await addMember(orgId, ["cashier"]);
    const leadId = await newLead(agentA);

    await expect(
      createBuyer(agentB, createBuyerSchema.parse({ ...rawBuyer, leadId })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { id } = await createBuyer(agentA, createBuyerSchema.parse({ ...rawBuyer, leadId }));

    const detail = await getBuyer(agentA, id);
    expect(detail).toMatchObject({
      ownerUserId: agentA.userId,
      leadId,
      nin: "109085198500123456",
      phone: "+213550123456",
      leadName: "Karim Bensalem",
      missingRequired: 6,
    });
    expect(await getBuyer(agentB, id)).toBeNull();
    expect((await listBuyers(manager, {})).total).toBe(1);
    expect((await listBuyers(cashier, { q: "bensal" })).total).toBe(1);
    expect((await listBuyers(agentB, {})).total).toBe(0);
    await expect(
      createBuyer(cashier, createBuyerSchema.parse({ ...rawBuyer, nin: "" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a malformed or already used NIN", async () => {
    const { manager } = await createSalesTeam();
    expect(
      createBuyerSchema.safeParse({ ...rawBuyer, nin: "12345" }).error?.issues[0]?.message,
    ).toBe("validation.nin");
    const { id } = await createBuyer(manager, createBuyerSchema.parse(rawBuyer));
    await expect(
      createBuyer(manager, createBuyerSchema.parse({ ...rawBuyer, firstName: "Amine" })),
    ).rejects.toMatchObject({ code: "CONFLICT", messageKey: "buyers.errors.ninTaken" });
    await updateBuyer(
      manager,
      updateBuyerSchema.parse({ ...rawBuyer, buyerId: id, phone: "0661 00 00 00" }),
    );
    expect((await getBuyer(manager, id))?.phone).toBe("+213661000000");
  });

  it("tracks the document checklist; scans follow the buyer's visibility", async () => {
    const { manager, agentA, agentB } = await createSalesTeam();
    const leadId = await newLead(agentA);
    const { id } = await createBuyer(agentA, createBuyerSchema.parse({ ...rawBuyer, leadId }));

    await setBuyerDocument(
      agentA,
      setBuyerDocumentSchema.parse({ buyerId: id, kind: "birth_certificate", status: "verified" }),
    );
    const { fileId } = await setBuyerDocumentScan(agentA, {
      buyerId: id,
      kind: "id_card",
      upload: { fileName: "CNI recto-verso.pdf", bytes: pdf() },
    });
    const detail = await getBuyer(manager, id);
    expect(detail?.missingRequired).toBe(4);
    expect(detail?.documents.find((d) => d.kind === "id_card")).toMatchObject({
      status: "received",
      fileId,
      fileName: "CNI recto-verso.pdf",
    });
    await expect(getFileDownloadUrl(manager, fileId, "inline")).resolves.toMatch(/^http/);
    await expect(getFileDownloadUrl(agentB, fileId, "inline")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      setBuyerDocumentScan(agentA, {
        buyerId: id,
        kind: "payslips",
        upload: { fileName: "x.txt", bytes: new TextEncoder().encode("hello") },
      }),
    ).rejects.toMatchObject({ messageKey: "files.errors.type" });
  });
});
