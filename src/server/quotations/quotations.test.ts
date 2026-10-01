import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { auditLog, file, lead, quotation, quotationLine } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { sumCentimes } from "@/lib/money";
import { quotationHtml } from "@/pdf/quotation";
import type { TenantCtx } from "@/server/auth/session";
import { createLead } from "@/server/crm/leads";
import { createLeadSchema } from "@/server/crm/schemas";
import { getFileDownloadUrl } from "@/server/files/service";
import {
  createBuildingSchema,
  createProjectSchema,
  createUnitSchema,
  unitStatusReasonSchema,
  updateUnitPriceSchema,
} from "@/server/inventory/schemas";
import {
  blockUnit,
  createBuilding,
  createProject,
  createUnit,
  updateUnitPrice,
} from "@/server/inventory/service";
import { companySettingsSchema } from "@/server/organizations/schemas";
import { updateCompanySettings } from "@/server/organizations/settings";
import { getProjectPaymentSetup } from "@/server/payment-plans/queries";
import {
  createPaymentPlanSchema,
  saveMilestonesSchema,
  updatePaymentPlanSchema,
} from "@/server/payment-plans/schemas";
import {
  createPaymentPlan,
  deletePaymentPlan,
  saveMilestones,
  updatePaymentPlan,
} from "@/server/payment-plans/service";

import { companySettingsInput, createSalesTeam } from "../../../tests/factories";

import { renderAndStoreQuotationPdf } from "./pdf";
import { getQuotation, loadQuotationDocument } from "./queries";
import { cancelQuotationSchema, issueQuotationSchema } from "./schemas";
import { cancelQuotation, issueQuotation } from "./service";

type Team = Awaited<ReturnType<typeof createSalesTeam>>;

/** A project with a building, two priced units, two milestones and a 20/30/50 plan. */
async function setup(team: Team) {
  const { owner, manager } = team;
  const { id: projectId } = await createProject(
    owner,
    createProjectSchema.parse({ code: "OLIV", name: "Résidence Les Oliviers", status: "planning" }),
  );
  const { id: buildingId } = await createBuilding(
    owner,
    createBuildingSchema.parse({
      projectId,
      code: "A",
      name: "Bloc A",
      lowestFloor: "0",
      topFloor: "5",
    }),
  );
  const unitIds: string[] = [];
  for (const code of ["A-03-02", "A-04-01"]) {
    const { id } = await createUnit(
      manager,
      createUnitSchema.parse({
        buildingId,
        code,
        floor: code.slice(2, 4),
        type: "apartment",
        typology: "F3",
        isDuplex: false,
        livingArea: "86,75",
        orientations: [],
      }),
    );
    await updateUnitPrice(
      manager,
      updateUnitPriceSchema.parse({ unitId: id, price: "13 010 000", reason: "Grille" }),
    );
    unitIds.push(id);
  }
  await saveMilestones(
    manager,
    saveMilestonesSchema.parse({
      projectId,
      milestones: [
        { id: "", name: "Fondations", plannedOn: "2026-12-15" },
        { id: "", name: "Gros œuvre", plannedOn: "2027-06-30" },
      ],
    }),
  );
  const { milestones } = await getProjectPaymentSetup(manager, projectId);
  const [foundations, structure] = milestones;
  const { id: planId } = await createPaymentPlan(
    manager,
    createPaymentPlanSchema.parse({
      projectId,
      name: "VSP standard",
      isDefault: false,
      steps: [
        { label: "Réservation", share: "20", trigger: "signing", months: "", milestoneId: "" },
        {
          label: "Fondations",
          share: "30",
          trigger: "milestone",
          months: "",
          milestoneId: foundations?.id ?? "",
        },
        {
          label: "Gros œuvre",
          share: "50",
          trigger: "milestone",
          months: "",
          milestoneId: structure?.id ?? "",
        },
      ],
    }),
  );
  return { projectId, unitIds, planId, milestones };
}

const newLead = async (ctx: TenantCtx, phone = "0550 12 34 56") =>
  (
    await createLead(
      ctx,
      createLeadSchema.parse({
        fullName: "Karim Bensalem",
        phone,
        source: "walk_in",
        typologies: [],
      }),
    )
  ).id;

const issue = (ctx: TenantCtx, leadId: string, unitId: string, planId: string, discount = "") =>
  issueQuotation(
    ctx,
    issueQuotationSchema.parse({ leadId, unitId, paymentPlanId: planId, discount, notes: "" }),
  );

describe("payment plans", () => {
  it("makes the first plan the default and requires shares to total 100 %", async () => {
    const team = await createSalesTeam();
    const { projectId, planId } = await setup(team);
    const { plans } = await getProjectPaymentSetup(team.manager, projectId);
    expect(plans.map((p) => [p.id, p.isDefault, p.steps.length])).toEqual([[planId, true, 3]]);

    const bad = createPaymentPlanSchema.safeParse({
      projectId,
      name: "Mauvais",
      isDefault: false,
      steps: [{ label: "Tout", share: "90", trigger: "signing", months: "", milestoneId: "" }],
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe("paymentPlans.errors.total");
  });

  it("moves the default, refuses foreign milestones and protects used milestones", async () => {
    const team = await createSalesTeam();
    const { projectId, planId, milestones } = await setup(team);
    const other = await createProject(
      team.owner,
      createProjectSchema.parse({ code: "CORN", name: "Corniche", status: "planning" }),
    );

    const { id: second } = await createPaymentPlan(
      team.manager,
      createPaymentPlanSchema.parse({
        projectId,
        name: "Comptant",
        isDefault: true,
        steps: [{ label: "Tout", share: "100", trigger: "signing", months: "", milestoneId: "" }],
      }),
    );
    let setupNow = await getProjectPaymentSetup(team.manager, projectId);
    expect(setupNow.plans.find((p) => p.isDefault)?.id).toBe(second);

    await expect(
      createPaymentPlan(
        team.manager,
        createPaymentPlanSchema.parse({
          projectId: other.id,
          name: "Emprunté",
          isDefault: false,
          steps: [
            {
              label: "Fondations",
              share: "100",
              trigger: "milestone",
              months: "",
              milestoneId: milestones[0]?.id ?? "",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ messageKey: "paymentPlans.errors.milestoneNotFound" });

    await expect(
      saveMilestones(team.manager, saveMilestonesSchema.parse({ projectId, milestones: [] })),
    ).rejects.toMatchObject({ code: "CONFLICT", messageKey: "paymentPlans.errors.milestoneInUse" });

    await updatePaymentPlan(
      team.manager,
      updatePaymentPlanSchema.parse({
        planId,
        name: "VSP 12 mois",
        isDefault: false,
        steps: [
          { label: "Signature", share: "40", trigger: "signing", months: "", milestoneId: "" },
          {
            label: "Solde",
            share: "60",
            trigger: "months_after_signing",
            months: "12",
            milestoneId: "",
          },
        ],
      }),
    );
    await deletePaymentPlan(team.manager, { planId: second });
    setupNow = await getProjectPaymentSetup(team.manager, projectId);
    expect(setupNow.plans.map((p) => [p.name, p.isDefault, p.steps.map((s) => s.trigger)])).toEqual(
      [["VSP 12 mois", true, ["signing", "months_after_signing"]]],
    );
    // Milestones are no longer used: they can go.
    await saveMilestones(team.manager, saveMilestonesSchema.parse({ projectId, milestones: [] }));
    expect((await getProjectPaymentSetup(team.manager, projectId)).milestones).toEqual([]);

    await expect(
      createPaymentPlan(
        team.agentA,
        createPaymentPlanSchema.parse({
          projectId,
          name: "X",
          isDefault: false,
          steps: [{ label: "Tout", share: "100", trigger: "signing", months: "", milestoneId: "" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("quotations", () => {
  it("issues a numbered quotation with an exact schedule, and moves the lead on", async () => {
    const team = await createSalesTeam();
    const { unitIds, planId } = await setup(team);
    await updateCompanySettings(
      team.owner,
      companySettingsSchema.parse(companySettingsInput({ quotationValidityDays: "30" })),
    );
    const leadId = await newLead(team.agentA);

    const { id, number } = await issue(team.agentA, leadId, unitIds[0] ?? "", planId);

    const today = todayInAlgiers();
    expect(number).toBe(`DEV-${today.slice(0, 4)}-000001`);
    const detail = await getQuotation(team.agentA, id);
    expect(detail).toMatchObject({
      listPrice: 1_301_000_000n,
      discount: 0n,
      price: 1_301_000_000n,
      signingOn: today,
      validUntil: addDays(today, 30),
      status: "issued",
      unitCode: "A-03-02",
    });
    expect(detail?.lines.map((l) => [l.label, l.amount, l.dueOn])).toEqual([
      ["Réservation", 260_200_000n, today],
      ["Fondations", 390_300_000n, "2026-12-15"],
      ["Gros œuvre", 650_500_000n, "2027-06-30"],
    ]);
    expect(sumCentimes(detail?.lines.map((l) => l.amount) ?? [])).toBe(detail?.price);

    const [leadRow] = await withTenant(team.agentA, (tx) =>
      tx.select({ stage: lead.stage }).from(lead).where(eq(lead.id, leadId)),
    );
    expect(leadRow?.stage).toBe("negotiation");
    const audit = await withTenant(team.owner, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.entityId, id)),
    );
    expect(audit.map((a) => a.action)).toEqual(["quotation.issue"]);

    // The PDF job was enqueued in the same transaction.
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pgboss.job where name = 'pdf.document' and data->>'kind' = 'quotation' and data->>'id' = ${id}`,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("lets only managers discount, within the price", async () => {
    const team = await createSalesTeam();
    const { unitIds, planId } = await setup(team);
    const leadId = await newLead(team.agentA);
    const unitId = unitIds[0] ?? "";

    await expect(issue(team.agentA, leadId, unitId, planId, "500 000")).rejects.toMatchObject({
      code: "FORBIDDEN",
      messageKey: "quotations.errors.discountForbidden",
    });
    await expect(issue(team.manager, leadId, unitId, planId, "99 000 000")).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const { id } = await issue(team.manager, leadId, unitId, planId, "510 000");
    expect(await getQuotation(team.manager, id)).toMatchObject({
      discount: 51_000_000n,
      price: 1_250_000_000n,
    });
  });

  it("refuses units that are not on sale or not priced, and other commercials' leads", async () => {
    const team = await createSalesTeam();
    const { unitIds, planId } = await setup(team);
    const leadId = await newLead(team.agentA);
    await blockUnit(
      team.manager,
      unitStatusReasonSchema.parse({ unitId: unitIds[1], reason: "Logement témoin" }),
    );

    await expect(issue(team.agentA, leadId, unitIds[1] ?? "", planId)).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "quotations.errors.unitNotAvailable",
    });
    await expect(issue(team.agentB, leadId, unitIds[0] ?? "", planId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const count = await withTenant(team.owner, (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(quotation),
    );
    expect(count[0]?.n).toBe(0);
  });

  it("is cancelled by a manager with a reason, once", async () => {
    const team = await createSalesTeam();
    const { unitIds, planId } = await setup(team);
    const leadId = await newLead(team.agentA);
    const { id } = await issue(team.agentA, leadId, unitIds[0] ?? "", planId);
    const input = cancelQuotationSchema.parse({ quotationId: id, reason: "Erreur de lot" });

    await expect(cancelQuotation(team.agentA, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await cancelQuotation(team.manager, input);
    await expect(cancelQuotation(team.manager, input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await getQuotation(team.manager, id)).toMatchObject({
      status: "cancelled",
      cancellationReason: "Erreur de lot",
    });
    // Lines are append-only and quotations are never deleted.
    await expect(
      withTenant(team.owner, (tx) => tx.delete(quotation).where(eq(quotation.id, id))),
    ).rejects.toThrow();
    await expect(
      withTenant(team.owner, (tx) =>
        tx.update(quotationLine).set({ amount: 0n }).where(eq(quotationLine.quotationId, id)),
      ),
    ).rejects.toThrow();
  });

  it("renders a bilingual PDF once and only lets the lead's owner or managers download it", async () => {
    const team = await createSalesTeam();
    const { unitIds, planId } = await setup(team);
    await updateCompanySettings(
      team.owner,
      companySettingsSchema.parse(
        companySettingsInput({
          legalName: "SARL El Bahdja Immobilier",
          rcNumber: "16/00-1234567B19",
        }),
      ),
    );
    const leadId = await newLead(team.agentA);
    const { id, number } = await issue(team.agentA, leadId, unitIds[0] ?? "", planId);
    const payload = { organizationId: team.orgId, quotationId: id };

    const doc = await withTenant(team.owner, (tx) => loadQuotationDocument(tx, team.orgId, id));
    const html = doc ? quotationHtml(doc) : "";
    expect(html).toContain("SARL El Bahdja Immobilier");
    expect(html).toContain("عرض سعر");
    expect(html).toContain("treize millions dix mille dinars");
    expect(html).toContain('dir="rtl"');

    expect(await renderAndStoreQuotationPdf(payload)).toBe("stored");
    expect(await renderAndStoreQuotationPdf(payload)).toBe("skipped");

    const detail = await getQuotation(team.agentA, id);
    const [stored] = await withTenant(team.owner, (tx) =>
      tx
        .select()
        .from(file)
        .where(and(eq(file.entityType, "quotation"), eq(file.entityId, id))),
    );
    expect(stored).toMatchObject({
      id: detail?.pdfFileId,
      fileName: `${number}.pdf`,
      contentType: "application/pdf",
      uploadedBy: null,
    });

    const fileId = detail?.pdfFileId ?? "";
    const url = await getFileDownloadUrl(team.agentA, fileId, "attachment");
    const response = await fetch(url);
    expect(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    await expect(getFileDownloadUrl(team.manager, fileId, "inline")).resolves.toMatch(/^http/);
    await expect(getFileDownloadUrl(team.agentB, fileId, "inline")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
