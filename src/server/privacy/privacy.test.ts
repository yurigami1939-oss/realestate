import { eq } from "drizzle-orm";
import readXlsxFile from "read-excel-file/node";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, followUp, lead } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { ANONYMIZED_NAME } from "@/lib/privacy";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { createFollowUp } from "@/server/crm/follow-ups";
import { createLead } from "@/server/crm/leads";
import { createFollowUpSchema, createLeadSchema } from "@/server/crm/schemas";
import { buildExport } from "@/server/exports/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { anonymizeLead } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

/** Headers and labels stay as their keys: the tests read the cells, not the wording. */
const t = (key: string) => key;
const today = todayInAlgiers();

describe("personal data (Loi 18-07)", () => {
  it("exports what is held about a buyer, for managers only", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        email: "karim@example.test",
      }),
    );
    const { id: saleId } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: today,
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount: "100 000",
        method: "cash",
        paidOn: today,
        payerName: "Bensalem Karim",
      }),
    );
    await expect(
      buildExport(team.agentA, "person", { buyer: buyerId }, "fr", t),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(buildExport(team.manager, "person", {}, "fr", t)).rejects.toMatchObject({
      messageKey: "privacy.errors.onePerson",
    });
    const { file, bytes } = await buildExport(team.manager, "person", { buyer: buyerId }, "fr", t);
    expect(file).toMatch(/^donnees-Bensalem-Karim-loi-18-07\.xlsx$/);
    const sheets = await readXlsxFile(bytes);
    expect(sheets.map((s) => s.sheet)).toEqual([
      "privacy.sheets.identity",
      "privacy.sheets.documents",
      "privacy.sheets.sales",
      "privacy.sheets.payments",
      "privacy.sheets.messages",
    ]);
    const identity = sheets[0]?.data ?? [];
    expect(identity).toContainEqual(["buyers.fields.email", "karim@example.test"]);
    expect(sheets[3]?.data.slice(1).map((r) => r[4])).toEqual([100_000]);
    // The export is audited like every export.
    const audits = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, team.orgId)),
    );
    expect(audits.map((a) => a.action)).toContain("organization.export");
  });

  it("anonymizes a prospect who never bought; keeps one who did", async () => {
    const team = await createSalesTeam();
    const { id: leadId } = await createLead(
      team.agentA,
      createLeadSchema.parse({
        fullName: "Yacine Ferhat",
        phone: "0661 22 33 44",
        email: "yacine@example.test",
        city: "Oran",
        source: "facebook",
        typologies: [],
        notes: "Rappeler après 18 h",
      }),
    );
    await createFollowUp(
      team.agentA,
      createFollowUpSchema.parse({
        leadId,
        dueAt: `${addDays(today, 1)}T10:00`,
        channel: "call",
        note: "Proposer le F3 du bloc A",
      }),
    );
    const erase = { leadId, reason: "Demande de la personne par téléphone" };
    await expect(anonymizeLead(team.agentA, erase)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await anonymizeLead(team.manager, erase);
    const [row] = await withTenant(team.manager, (tx) =>
      tx.select().from(lead).where(eq(lead.id, leadId)),
    );
    expect(row).toMatchObject({
      fullName: ANONYMIZED_NAME,
      email: null,
      city: null,
      notes: null,
      source: "facebook",
    });
    expect(row?.phone.startsWith("anonyme-")).toBe(true);
    const [task] = await withTenant(team.manager, (tx) =>
      tx.select({ note: followUp.note }).from(followUp).where(eq(followUp.leadId, leadId)),
    );
    expect(task?.note).toBeNull();
    await expect(anonymizeLead(team.manager, erase)).rejects.toMatchObject({
      messageKey: "privacy.errors.alreadyAnonymized",
    });

    // A prospect who became a buyer keeps its data with its contracts.
    const { id: buyerLead } = await createLead(
      team.manager,
      createLeadSchema.parse({
        fullName: "Karim Bensalem",
        phone: "0550 12 34 56",
        source: "walk_in",
        typologies: [],
      }),
    );
    await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        leadId: buyerLead,
      }),
    );
    await expect(
      anonymizeLead(team.manager, { leadId: buyerLead, reason: "Demande" }),
    ).rejects.toMatchObject({ messageKey: "privacy.errors.leadHasBuyer" });
  });
});
