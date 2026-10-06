import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { portalLink } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { createBuyerSchema, setBuyerDocumentSchema } from "@/server/buyers/schemas";
import { getBuyer } from "@/server/buyers/queries";
import { createBuyer, setBuyerDocument } from "@/server/buyers/service";
import { getDashboard } from "@/server/dashboard/queries";

import { addMember, createSalesTeam } from "../../../tests/factories";

import type { PortalCtx } from "./context";
import { listPortalBuyerDocuments, uploadPortalBuyerDocument } from "./documents";

afterAll(async () => {
  await stopEnqueue();
});

const scan = () => ({
  fileName: "cni.pdf",
  bytes: new TextEncoder().encode("%PDF-1.7\nscan\n%%EOF"),
});

describe("portal documents", () => {
  it("lets a buyer send the pieces of their own file, which staff then verify", async () => {
    const team = await createSalesTeam();
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        leadId: "",
      }),
    );
    const member = await addMember(team.orgId, ["resident"]);
    await withTenant(team.manager, (tx) =>
      tx.insert(portalLink).values({
        organizationId: team.orgId,
        email: `client-${randomUUID().slice(0, 8)}@example.test`,
        userId: member.userId,
        buyerId,
        createdBy: team.manager.userId,
      }),
    );
    const portal: PortalCtx = { userId: member.userId, orgId: team.orgId, name: "K", locale: "fr" };

    const [file] = await listPortalBuyerDocuments(portal);
    expect(file?.documents.map((d) => [d.kind, d.status])).toEqual([
      ["id_card", "missing"],
      ["birth_certificate", "missing"],
      ["family_record", "missing"],
      ["residence_certificate", "missing"],
      ["employment_certificate", "missing"],
      ["payslips", "missing"],
    ]);

    await uploadPortalBuyerDocument(portal, { buyerId, kind: "id_card", upload: scan() });
    // Another account cannot reach this file; a script is not a document.
    const stranger = await addMember(team.orgId, ["resident"]);
    await expect(
      uploadPortalBuyerDocument(
        { userId: stranger.userId, orgId: team.orgId, name: "X", locale: "fr" },
        { buyerId, kind: "id_card", upload: scan() },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      uploadPortalBuyerDocument(portal, {
        buyerId,
        kind: "payslips",
        upload: { fileName: "x.html", bytes: new TextEncoder().encode("<script>") },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const staffView = await getBuyer(team.manager, buyerId);
    expect(staffView?.documents.find((d) => d.kind === "id_card")).toMatchObject({
      status: "received",
      submittedFromPortal: true,
    });
    expect((await getDashboard(team.manager)).todo.portalDocuments).toBe(1);

    // Verified by staff: no longer to verify, nor replaced from the portal.
    await setBuyerDocument(
      team.manager,
      setBuyerDocumentSchema.parse({ buyerId, kind: "id_card", status: "verified", note: "" }),
    );
    expect((await getDashboard(team.manager)).todo.portalDocuments).toBe(0);
    await expect(
      uploadPortalBuyerDocument(portal, { buyerId, kind: "id_card", upload: scan() }),
    ).rejects.toMatchObject({ messageKey: "portal.documents.errors.verified" });
  });
});
