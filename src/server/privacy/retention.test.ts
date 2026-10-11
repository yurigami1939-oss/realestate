import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, lead, smsMessage, whatsappMessage } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addMonths, todayInAlgiers } from "@/lib/dates";
import { ANONYMIZED_NAME, ERASED_RECIPIENT, retentionCutoff } from "@/lib/privacy";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { changeLeadStage, createLead } from "@/server/crm/leads";
import { changeLeadStageSchema, createLeadSchema } from "@/server/crm/schemas";

import { createSalesTeam } from "../../../tests/factories";

import { applyRetention, getPrivacySettings, savePrivacySettings } from "./retention";
import { privacySettingsSchema } from "./schemas";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("retention periods", () => {
  it("computes the cutoff, nothing when off", () => {
    expect(retentionCutoff("2026-10-11", 24)).toBe("2024-10-11");
    expect(retentionCutoff("2026-10-11", 0)).toBeNull();
  });

  it("anonymizes stale prospects and erases old messages once their periods are set", async () => {
    const team = await createSalesTeam();
    const newLead = (fullName: string, phone: string) =>
      createLead(
        team.manager,
        createLeadSchema.parse({ fullName, phone, source: "facebook", typologies: [] }),
      );
    const { id: staleId } = await newLead("Karim Bensalem", "0550 12 34 56");
    const { id: buyerLeadId } = await newLead("Amina Kaci", "0661 22 33 44");
    const { id: wonId } = await newLead("Nadir Ouali", "0770 55 66 77");
    await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Kaci",
        firstName: "Amina",
        phone: "0661 22 33 44",
        email: "",
        leadId: buyerLeadId,
      }),
    );
    await changeLeadStage(
      team.manager,
      changeLeadStageSchema.parse({ leadId: wonId, stage: "won", lostReason: "", lostNote: "" }),
    );
    // A message of each channel, sent today.
    await withTenant(team.owner, async (tx) => {
      await tx.insert(whatsappMessage).values({
        organizationId: team.orgId,
        kind: "payment_received",
        recipient: "213550123456",
        recipientName: "Karim Bensalem",
        template: "paiement_recu",
        language: "fr",
        params: ["Karim"],
        refType: "lead",
        refId: staleId,
      });
      await tx.insert(smsMessage).values({
        organizationId: team.orgId,
        kind: "payment_received",
        recipient: "+213550123456",
        recipientName: "Karim Bensalem",
        text: "Bonjour Karim",
        segments: 1,
      });
    });

    // Off by default: a run a year from now changes nothing.
    const later = addMonths(today, 13);
    expect(await applyRetention(team.orgId, later)).toEqual({ leads: 0, messages: 0, visitors: 0 });

    await expect(
      savePrivacySettings(
        team.manager,
        privacySettingsSchema.parse({ leadRetentionMonths: "12", messageRetentionMonths: "12" }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(() => privacySettingsSchema.parse({ leadRetentionMonths: "121" })).toThrow();
    await savePrivacySettings(
      team.owner,
      privacySettingsSchema.parse({ leadRetentionMonths: "12", messageRetentionMonths: "12" }),
    );
    expect(await getPrivacySettings(team.owner)).toEqual({
      leadRetentionMonths: 12,
      messageRetentionMonths: 12,
      visitorRetentionMonths: 0,
    });
    // Within the period, nothing yet.
    expect(await applyRetention(team.orgId, addMonths(today, 11))).toEqual({
      leads: 0,
      messages: 0,
      visitors: 0,
    });
    // Past it: the prospect who never bought is anonymized, the buyer's and the won one stay.
    expect(await applyRetention(team.orgId, later)).toEqual({ leads: 1, messages: 2, visitors: 0 });
    const leads = await withTenant(team.owner, (tx) =>
      tx.select({ id: lead.id, fullName: lead.fullName, phone: lead.phone }).from(lead),
    );
    const name = (id: string) => leads.find((l) => l.id === id)?.fullName;
    expect(name(staleId)).toBe(ANONYMIZED_NAME);
    expect(name(buyerLeadId)).toBe("Amina Kaci");
    expect(name(wonId)).toBe("Nadir Ouali");
    const [message] = await withTenant(team.owner, (tx) => tx.select().from(whatsappMessage));
    expect(message).toMatchObject({
      recipient: ERASED_RECIPIENT,
      recipientName: ERASED_RECIPIENT,
      params: [],
      status: "queued",
    });
    const [sms] = await withTenant(team.owner, (tx) => tx.select().from(smsMessage));
    expect(sms).toMatchObject({ recipient: ERASED_RECIPIENT, text: "" });
    // Idempotent.
    expect(await applyRetention(team.orgId, later)).toEqual({ leads: 0, messages: 0, visitors: 0 });

    const audits = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action, actor: auditLog.actorUserId, reason: auditLog.reason })
        .from(auditLog)
        .where(and(eq(auditLog.organizationId, team.orgId), eq(auditLog.entityId, staleId))),
    );
    expect(audits).toContainEqual({
      action: "lead.anonymize",
      actor: null,
      reason: "Durée de conservation dépassée",
    });
    const runs = await withTenant(team.owner, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, "organization.retention")),
    );
    expect(runs).toHaveLength(1);
  });
});
