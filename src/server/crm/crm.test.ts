import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, followUp, lead, visit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { TenantCtx } from "@/server/auth/session";

import { addMember, createSalesTeam } from "../../../tests/factories";

import { completeFollowUp, createFollowUp } from "./follow-ups";
import {
  addLeadNote,
  assignLead,
  changeLeadStage,
  createLead,
  mergeLeads,
  updateLead,
} from "./leads";
import { getLead, getPipeline, listDuplicateGroups, listLeads, listOpenFollowUps } from "./queries";
import {
  changeLeadStageSchema,
  createFollowUpSchema,
  createLeadSchema,
  saveTargetsSchema,
  scheduleVisitSchema,
  updateLeadSchema,
  updateVisitSchema,
} from "./schemas";
import { getTargetProgress, saveTargets } from "./targets";
import { scheduleVisit, updateVisit } from "./visits";

const rawLead = {
  fullName: "Karim Bensalem",
  phone: "0550 12 34 56",
  source: "facebook",
  typologies: ["F3"],
};

const leadInput = (overrides: Record<string, unknown> = {}) =>
  createLeadSchema.parse({ ...rawLead, ...overrides });

const newLead = (ctx: TenantCtx, overrides: Record<string, unknown> = {}) =>
  createLead(ctx, leadInput(overrides));

const leadRow = (ctx: TenantCtx, id: string) =>
  withTenant(ctx, async (tx) => (await tx.select().from(lead).where(eq(lead.id, id)))[0]);

const tomorrowAt = (hour: number) => {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return `${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00`;
};

describe("leads", () => {
  it("gives a commercial's lead to them, normalizes phones and starts the timeline", async () => {
    const { agentA } = await createSalesTeam();
    const { id, duplicates } = await newLead(agentA, {
      assignedTo: "",
      phone2: "+33 6 12 34 56 78",
      budget: "15 000 000",
    });

    const row = await leadRow(agentA, id);
    expect(row).toMatchObject({
      assignedTo: agentA.userId,
      phone: "+213550123456",
      phone2: "+33612345678",
      budget: 1_500_000_000n,
      stage: "new",
      createdBy: agentA.userId,
    });
    expect(duplicates).toBe(0);
    const detail = await getLead(agentA, id);
    expect(detail?.activities.map((a) => a.type)).toEqual(["created"]);
  });

  it("rejects invalid phones in the schema", () => {
    const result = createLeadSchema.safeParse({
      fullName: "X",
      phone: "0550 12",
      source: "phone",
      typologies: [],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("validation.phone");
  });

  it("shows a commercial only their own leads; managers see all", async () => {
    const { manager, agentA, agentB } = await createSalesTeam();
    const mine = await newLead(agentA);
    const theirs = await newLead(agentB, { phone: "0661 11 22 33" });

    expect((await listLeads(agentA, {})).rows.map((r) => r.id)).toEqual([mine.id]);
    expect(await getLead(agentA, theirs.id)).toBeNull();
    await expect(
      updateLead(agentA, updateLeadSchema.parse({ ...rawLead, leadId: theirs.id })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listLeads(manager, {})).total).toBe(2);
  });

  it("allows duplicates and flags them; only managers see who holds them", async () => {
    const { manager, agentA, agentB } = await createSalesTeam();
    const first = await newLead(agentA);
    const second = await newLead(agentB, { fullName: "K. Bensalem", phone: "+213 550 123 456" });
    expect(second.duplicates).toBe(1);

    const agentView = await getLead(agentB, second.id);
    expect(agentView?.duplicateCount).toBe(1);
    expect(agentView?.duplicates).toEqual([]);
    const managerView = await getLead(manager, second.id);
    expect(managerView?.duplicates.map((d) => d.id)).toEqual([first.id]);

    const flagged = await listLeads(manager, { duplicates: "1" });
    expect(flagged.rows.map((r) => r.duplicate)).toEqual([true, true]);
    const groups = await listDuplicateGroups(manager);
    expect(groups).toEqual([
      { phone: "+213550123456", leads: expect.arrayContaining([expect.anything()]) },
    ]);
    expect(groups[0]?.leads).toHaveLength(2);
    await expect(listDuplicateGroups(agentA)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("searches by name or by phone typed the national way", async () => {
    const { manager } = await createSalesTeam();
    await newLead(manager, { fullName: "Amina Kaci", phone: "0770 98 76 54" });
    await newLead(manager, { fullName: "Samir Ouali", phone: "0550 11 22 33" });

    const byPhone = await listLeads(manager, { q: "0770 98" });
    expect(byPhone.rows.map((r) => r.fullName)).toEqual(["Amina Kaci"]);
    const byName = await listLeads(manager, { q: "ouali" });
    expect(byName.rows.map((r) => r.fullName)).toEqual(["Samir Ouali"]);
    expect((await listLeads(manager, { q: "100%" })).total).toBe(0);
  });

  it("lets managers leave leads unassigned and assign them to sales members only", async () => {
    const { orgId, manager, agentA } = await createSalesTeam();
    const cashier = await addMember(orgId, ["cashier"]);
    const { id } = await newLead(manager, { assignedTo: "" });
    expect((await leadRow(manager, id))?.assignedTo).toBeNull();
    expect((await listLeads(manager, { assignee: "none" })).total).toBe(1);

    await expect(
      assignLead(manager, { leadId: id, assignedTo: cashier.userId }),
    ).rejects.toMatchObject({ code: "VALIDATION", messageKey: "crm.errors.notAssignable" });
    await assignLead(manager, { leadId: id, assignedTo: agentA.userId });
    expect((await leadRow(manager, id))?.assignedTo).toBe(agentA.userId);
    await expect(assignLead(agentA, { leadId: id, assignedTo: null })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("moves the previous owner's open follow-ups on reassignment", async () => {
    const { manager, agentA, agentB } = await createSalesTeam();
    const { id } = await newLead(agentA);
    const open = await createFollowUp(
      agentA,
      createFollowUpSchema.parse({ leadId: id, dueAt: tomorrowAt(10), channel: "call" }),
    );
    const done = await createFollowUp(
      agentA,
      createFollowUpSchema.parse({ leadId: id, dueAt: tomorrowAt(11), channel: "whatsapp" }),
    );
    await completeFollowUp(agentA, { followUpId: done.id, outcome: "Rappeler lundi" });

    await assignLead(manager, { leadId: id, assignedTo: agentB.userId });
    const rows = await withTenant(manager, (tx) =>
      tx.select().from(followUp).where(eq(followUp.leadId, id)),
    );
    expect(rows.find((r) => r.id === open.id)?.assignedTo).toBe(agentB.userId);
    expect(rows.find((r) => r.id === done.id)?.assignedTo).toBe(agentA.userId);
    expect((await listOpenFollowUps(agentB)).map((f) => f.id)).toEqual([open.id]);
    expect(await listOpenFollowUps(agentA)).toEqual([]);
  });
});

describe("pipeline", () => {
  it("requires a reason to mark a lead lost and records stage changes", async () => {
    const { agentA } = await createSalesTeam();
    const { id } = await newLead(agentA);
    expect(changeLeadStageSchema.safeParse({ leadId: id, stage: "lost" }).success).toBe(false);

    await changeLeadStage(
      agentA,
      changeLeadStageSchema.parse({
        leadId: id,
        stage: "lost",
        lostReason: "price",
        lostNote: "Trouve plus cher que Draria",
      }),
    );
    expect(await leadRow(agentA, id)).toMatchObject({ stage: "lost", lostReason: "price" });
    await changeLeadStage(agentA, changeLeadStageSchema.parse({ leadId: id, stage: "contacted" }));
    expect(await leadRow(agentA, id)).toMatchObject({ stage: "contacted", lostReason: null });

    const detail = await getLead(agentA, id);
    expect(detail?.activities.filter((a) => a.type === "stage_changed")).toHaveLength(2);
  });

  it("moves leads forward on events, never backwards", async () => {
    const { agentA } = await createSalesTeam();
    const { id } = await newLead(agentA);

    const call = await createFollowUp(
      agentA,
      createFollowUpSchema.parse({ leadId: id, dueAt: tomorrowAt(9), channel: "call" }),
    );
    await completeFollowUp(agentA, { followUpId: call.id, outcome: null });
    expect((await leadRow(agentA, id))?.stage).toBe("contacted");

    const planned = await scheduleVisit(
      agentA,
      scheduleVisitSchema.parse({ leadId: id, scheduledAt: tomorrowAt(15) }),
    );
    expect((await leadRow(agentA, id))?.stage).toBe("visit_scheduled");

    await updateVisit(
      agentA,
      updateVisitSchema.parse({
        visitId: planned.id,
        status: "done",
        scheduledAt: tomorrowAt(15),
        outcome: "Intéressé par le F3 du 4e",
      }),
    );
    expect((await leadRow(agentA, id))?.stage).toBe("visited");

    await changeLeadStage(
      agentA,
      changeLeadStageSchema.parse({ leadId: id, stage: "negotiation" }),
    );
    await scheduleVisit(
      agentA,
      scheduleVisitSchema.parse({ leadId: id, scheduledAt: tomorrowAt(16) }),
    );
    expect((await leadRow(agentA, id))?.stage).toBe("negotiation");

    const pipeline = await getPipeline(agentA);
    expect(pipeline.columns.find((c) => c.stage === "negotiation")?.total).toBe(1);
  });

  it("hosts a commercial's visit themselves; managers may pick the host", async () => {
    const { manager, agentA, agentB } = await createSalesTeam();
    const { id } = await newLead(agentA);
    const own = await scheduleVisit(
      agentA,
      scheduleVisitSchema.parse({
        leadId: id,
        scheduledAt: tomorrowAt(10),
        agentUserId: agentB.userId,
      }),
    );
    const byManager = await scheduleVisit(
      manager,
      scheduleVisitSchema.parse({
        leadId: id,
        scheduledAt: tomorrowAt(11),
        agentUserId: agentB.userId,
      }),
    );
    const hosts = await withTenant(manager, (tx) =>
      tx.select({ id: visit.id, agent: visit.agentUserId }).from(visit),
    );
    expect(hosts.find((v) => v.id === own.id)?.agent).toBe(agentA.userId);
    expect(hosts.find((v) => v.id === byManager.id)?.agent).toBe(agentB.userId);
  });
});

describe("merging duplicates", () => {
  it("moves visits and follow-ups, fills gaps and keeps the source's history", async () => {
    const { manager, agentA, agentB } = await createSalesTeam();
    const target = await newLead(agentA, { email: "" });
    const source = await newLead(agentB, {
      fullName: "Karim B.",
      phone: "0550 12 34 56",
      phone2: "0661 00 11 22",
      email: "karim@example.dz",
      notes: "Vient de la part d'un voisin",
    });
    await addLeadNote(agentB, { leadId: source.id, note: "Préfère les étages élevés" });
    const sourceVisit = await scheduleVisit(
      agentB,
      scheduleVisitSchema.parse({ leadId: source.id, scheduledAt: tomorrowAt(10) }),
    );

    await expect(
      mergeLeads(agentA, { targetId: target.id, sourceId: source.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await mergeLeads(manager, { targetId: target.id, sourceId: source.id });

    expect(await leadRow(manager, target.id)).toMatchObject({
      phone2: "+213661001122",
      email: "karim@example.dz",
      notes: "Vient de la part d'un voisin",
      stage: "visit_scheduled",
      assignedTo: agentA.userId,
    });
    expect(await leadRow(manager, source.id)).toMatchObject({
      mergedIntoId: target.id,
      deletedAt: expect.any(Date),
    });
    const moved = await withTenant(
      manager,
      async (tx) => (await tx.select().from(visit).where(eq(visit.id, sourceVisit.id)))[0],
    );
    expect(moved?.leadId).toBe(target.id);

    const detail = await getLead(manager, target.id);
    expect(detail?.duplicateCount).toBe(0);
    expect(detail?.activities.map((a) => a.type)).toEqual(
      expect.arrayContaining(["merged", "note", "visit_scheduled", "created"]),
    );
    const audit = await withTenant(manager, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "lead.merge"), eq(auditLog.entityId, target.id))),
    );
    expect(audit).toHaveLength(1);
  });
});

describe("tenancy", () => {
  it("never shows or changes another company's leads", async () => {
    const a = await createSalesTeam();
    const b = await createSalesTeam();
    const { id } = await newLead(a.manager);

    expect(await getLead(b.manager, id)).toBeNull();
    await expect(
      changeLeadStage(b.manager, changeLeadStageSchema.parse({ leadId: id, stage: "contacted" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      assignLead(a.manager, { leadId: id, assignedTo: b.agentA.userId }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await listLeads(b.manager, {})).total).toBe(0);
  });
});

describe("monthly targets", () => {
  it("counts done visits against targets; commercials see only their own line", async () => {
    const { orgId, owner, manager, agentA, agentB } = await createSalesTeam();
    const cashier = await addMember(orgId, ["cashier"]);
    const month = tomorrowAt(10).slice(0, 7);
    await saveTargets(
      manager,
      saveTargetsSchema.parse({
        month,
        targets: [
          { userId: agentA.userId, visits: "12", quotations: "4" },
          { userId: agentB.userId, visits: "8", quotations: "2" },
        ],
      }),
    );
    await expect(
      saveTargets(
        agentA,
        saveTargetsSchema.parse({
          month,
          targets: [{ userId: agentA.userId, visits: "99", quotations: "0" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      saveTargets(
        manager,
        saveTargetsSchema.parse({
          month,
          targets: [{ userId: cashier.userId, visits: "1", quotations: "0" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const { id } = await newLead(agentA);
    const done = await scheduleVisit(
      agentA,
      scheduleVisitSchema.parse({ leadId: id, scheduledAt: tomorrowAt(10) }),
    );
    await updateVisit(
      agentA,
      updateVisitSchema.parse({ visitId: done.id, status: "done", scheduledAt: tomorrowAt(10) }),
    );
    await scheduleVisit(
      agentA,
      scheduleVisitSchema.parse({ leadId: id, scheduledAt: tomorrowAt(11) }),
    );

    const mine = await getTargetProgress(agentA, month);
    expect(mine).toEqual([
      {
        userId: agentA.userId,
        name: expect.any(String),
        target: { visits: 12, quotations: 4 },
        actual: { visits: 1, quotations: 0 },
      },
    ]);
    const all = await getTargetProgress(manager, month);
    expect(all.map((r) => r.userId).sort()).toEqual(
      [owner.userId, agentA.userId, agentB.userId, manager.userId].sort(),
    );
  });
});
