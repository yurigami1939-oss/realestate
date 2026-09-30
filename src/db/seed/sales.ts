/**
 * Demo payment plans (construction milestones + plan templates per project) and a few
 * quotations for leads in negotiation. Their PDFs render when `pnpm worker` runs.
 */
import type { TenantCtx } from "@/server/auth/session";
import { getProjectPaymentSetup } from "@/server/payment-plans/queries";
import { createPaymentPlanSchema, saveMilestonesSchema } from "@/server/payment-plans/schemas";
import { createPaymentPlan, saveMilestones } from "@/server/payment-plans/service";
import { issueQuotationSchema } from "@/server/quotations/schemas";
import { issueQuotation } from "@/server/quotations/service";

type StepSpec =
  | { label: string; share: string; trigger: "signing" }
  | { label: string; share: string; trigger: "months_after_signing"; months: number }
  | { label: string; share: string; trigger: "milestone"; milestone: string };

type ProjectPlans = {
  milestones: { name: string; plannedOn: string }[];
  plans: { name: string; isDefault: boolean; notes?: string; steps: StepSpec[] }[];
};

export const demoPaymentPlans: Record<"OLIV" | "CORN", ProjectPlans> = {
  OLIV: {
    milestones: [
      { name: "Achèvement du gros œuvre", plannedOn: "2026-12-31" },
      { name: "Achèvement des travaux (tous corps d'état)", plannedOn: "2027-04-30" },
      { name: "Remise des clés", plannedOn: "2027-06-30" },
    ],
    plans: [
      {
        name: "VSP standard",
        isDefault: true,
        notes: "Les fondations étant achevées, leur tranche est due à la signature.",
        steps: [
          { label: "Signature (réservation + fondations)", share: "35", trigger: "signing" },
          {
            label: "Gros œuvre",
            share: "35",
            trigger: "milestone",
            milestone: "Achèvement du gros œuvre",
          },
          {
            label: "Achèvement des travaux",
            share: "25",
            trigger: "milestone",
            milestone: "Achèvement des travaux (tous corps d'état)",
          },
          {
            label: "Remise des clés",
            share: "5",
            trigger: "milestone",
            milestone: "Remise des clés",
          },
        ],
      },
      {
        name: "Paiement échelonné 24 mois",
        isDefault: false,
        steps: [
          { label: "Apport", share: "30", trigger: "signing" },
          { label: "Deuxième versement", share: "35", trigger: "months_after_signing", months: 12 },
          { label: "Solde", share: "35", trigger: "months_after_signing", months: 24 },
        ],
      },
    ],
  },
  CORN: {
    milestones: [
      { name: "Achèvement des fondations", plannedOn: "2027-03-31" },
      { name: "Achèvement du gros œuvre", plannedOn: "2028-03-31" },
      { name: "Achèvement des travaux", plannedOn: "2028-12-31" },
      { name: "Remise des clés", plannedOn: "2029-03-31" },
    ],
    plans: [
      {
        name: "VSP standard",
        isDefault: true,
        steps: [
          { label: "Réservation", share: "20", trigger: "signing" },
          {
            label: "Fondations",
            share: "15",
            trigger: "milestone",
            milestone: "Achèvement des fondations",
          },
          {
            label: "Gros œuvre",
            share: "35",
            trigger: "milestone",
            milestone: "Achèvement du gros œuvre",
          },
          {
            label: "Achèvement",
            share: "25",
            trigger: "milestone",
            milestone: "Achèvement des travaux",
          },
          {
            label: "Remise des clés",
            share: "5",
            trigger: "milestone",
            milestone: "Remise des clés",
          },
        ],
      },
    ],
  },
};

export async function seedPaymentPlans(
  manager: TenantCtx,
  projectIds: Map<string, string>,
): Promise<Map<string, string>> {
  /** Default plan id per project code. */
  const defaults = new Map<string, string>();
  for (const [code, spec] of Object.entries(demoPaymentPlans)) {
    const projectId = projectIds.get(code);
    if (!projectId) throw new Error(`seed: project ${code} missing`);
    await saveMilestones(
      manager,
      saveMilestonesSchema.parse({
        projectId,
        milestones: spec.milestones.map((m) => ({ id: "", ...m })),
      }),
    );
    const { milestones } = await getProjectPaymentSetup(manager, projectId);
    const milestoneId = (name: string) => {
      const found = milestones.find((m) => m.name === name);
      if (!found) throw new Error(`seed: milestone ${name} missing`);
      return found.id;
    };
    for (const plan of spec.plans) {
      const { id } = await createPaymentPlan(
        manager,
        createPaymentPlanSchema.parse({
          projectId,
          name: plan.name,
          isDefault: plan.isDefault,
          notes: plan.notes ?? "",
          steps: plan.steps.map((s) => ({
            label: s.label,
            share: s.share,
            trigger: s.trigger,
            months: s.trigger === "months_after_signing" ? String(s.months) : "",
            milestoneId: s.trigger === "milestone" ? milestoneId(s.milestone) : "",
          })),
        }),
      );
      if (plan.isDefault) defaults.set(code, id);
    }
  }
  return defaults;
}

/** Quotations for leads in negotiation; the directeur commercial grants one discount. */
export async function seedQuotations(
  actors: { manager: TenantCtx; agentA: TenantCtx; agentB: TenantCtx },
  ids: { leads: Map<string, string>; units: Map<string, string>; plans: Map<string, string> },
) {
  const specs = [
    { by: actors.agentA, lead: "Amina Kaci", unit: "A-05-04", discount: "" },
    { by: actors.agentB, lead: "Houda Meziane", unit: "B-03-02", discount: "" },
    { by: actors.manager, lead: "Djamel Benchikh", unit: "A-08-01", discount: "600 000" },
  ];
  for (const spec of specs) {
    const leadId = ids.leads.get(spec.lead);
    const unitId = ids.units.get(spec.unit);
    const planId = ids.plans.get("OLIV");
    if (!leadId || !unitId || !planId) throw new Error(`seed: quotation for ${spec.lead}`);
    await issueQuotation(
      spec.by,
      issueQuotationSchema.parse({
        leadId,
        unitId,
        paymentPlanId: planId,
        discount: spec.discount,
        notes: "",
      }),
    );
  }
}
