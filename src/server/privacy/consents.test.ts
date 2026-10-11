import readXlsxFile from "read-excel-file/node";
import { afterAll, describe, expect, it } from "vitest";

import { stopEnqueue } from "@/jobs/enqueue";
import { createBuyerSchema, updateBuyerSchema } from "@/server/buyers/schemas";
import { getBuyer } from "@/server/buyers/queries";
import { createBuyer, updateBuyer } from "@/server/buyers/service";
import { createLead, updateLead } from "@/server/crm/leads";
import { getLead } from "@/server/crm/queries";
import { createLeadSchema, updateLeadSchema } from "@/server/crm/schemas";
import { buildExport } from "@/server/exports/service";

import { createSalesTeam } from "../../../tests/factories";

import { getPersonPrivacy } from "./consents";

afterAll(async () => {
  await stopEnqueue();
});

const buyerFields = {
  lastName: "Bensalem",
  firstName: "Karim",
  phone: "0550 12 34 56",
  email: "",
  leadId: "",
};

describe("consents and reads of personal data", () => {
  it("keeps each consent given or withdrawn, and who opened the file", async () => {
    const team = await createSalesTeam();
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({ ...buyerFields, whatsappOptIn: true }),
    );
    // Commercial offers agreed later; a save without change records nothing.
    const update = (marketingConsent: boolean, whatsappOptIn = true) =>
      updateBuyer(
        team.manager,
        updateBuyerSchema.parse({ ...buyerFields, buyerId, whatsappOptIn, marketingConsent }),
      );
    await update(true);
    await update(true);
    await update(true, false);

    // Read twice by the directrice commerciale, once by the commercial who follows it.
    await getBuyer(team.manager, buyerId);
    await getBuyer(team.manager, buyerId);
    await getBuyer(team.agentA, buyerId).catch(() => null);

    expect(await getPersonPrivacy(team.agentA, { type: "buyer", id: buyerId })).toBeNull();
    const privacy = await getPersonPrivacy(team.manager, { type: "buyer", id: buyerId });
    expect(privacy?.consents.map((c) => [c.purpose, c.granted, c.source])).toEqual([
      ["whatsapp", false, "staff"],
      ["marketing", true, "staff"],
      ["whatsapp", true, "staff"],
    ]);
    expect(privacy?.consents[0]?.actorName).toBeTruthy();
    const mine = privacy?.accesses.find((a) => a.count === 2);
    expect(mine).toBeDefined();

    // A prospect's consent to commercial offers, given then withdrawn.
    const leadInput = {
      fullName: "Amina Kaci",
      phone: "0661 22 33 44",
      source: "facebook",
      typologies: [],
    };
    const { id: leadId } = await createLead(
      team.manager,
      createLeadSchema.parse({ ...leadInput, marketingConsent: true }),
    );
    await updateLead(
      team.manager,
      updateLeadSchema.parse({ ...leadInput, leadId, marketingConsent: false }),
    );
    await getLead(team.manager, leadId);
    const leadPrivacy = await getPersonPrivacy(team.manager, { type: "lead", id: leadId });
    expect(leadPrivacy?.consents.map((c) => [c.purpose, c.granted])).toEqual([
      ["marketing", false],
      ["marketing", true],
    ]);
    expect(leadPrivacy?.accesses).toHaveLength(1);

    // The right of access answers with both: two more sheets in the workbook.
    const t = (key: string) => key;
    const { bytes } = await buildExport(team.manager, "person", { buyer: buyerId }, "fr", t);
    const sheets = await readXlsxFile(bytes);
    expect(sheets.map((s) => s.sheet).slice(-2)).toEqual([
      "privacy.sheets.consents",
      "privacy.sheets.accesses",
    ]);
    expect(sheets.at(-2)?.data).toHaveLength(4);
  });
});
