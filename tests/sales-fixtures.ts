import type { TenantCtx } from "@/server/auth/session";
import { createLead } from "@/server/crm/leads";
import { createLeadSchema } from "@/server/crm/schemas";
import {
  createBuildingSchema,
  createProjectSchema,
  createUnitSchema,
  updateUnitPriceSchema,
} from "@/server/inventory/schemas";
import {
  createBuilding,
  createProject,
  createUnit,
  updateUnitPrice,
} from "@/server/inventory/service";
import { getProjectPaymentSetup } from "@/server/payment-plans/queries";
import { createPaymentPlanSchema, saveMilestonesSchema } from "@/server/payment-plans/schemas";
import { createPaymentPlan, saveMilestones } from "@/server/payment-plans/service";

import type { createSalesTeam } from "./factories";

type Team = Awaited<ReturnType<typeof createSalesTeam>>;

/**
 * A project with one building, three units priced 13 010 000 DA, two milestones
 * (foundations, structure) and a default 20 / 30 / 50 plan.
 */
export async function createSaleSetup(team: Team) {
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
  for (const code of ["A-03-01", "A-03-02", "A-04-01"]) {
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
      isDefault: true,
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
  return {
    projectId,
    unitIds: unitIds as [string, string, string],
    planId,
    milestoneIds: [foundations?.id ?? "", structure?.id ?? ""] as [string, string],
  };
}

export const newLead = async (ctx: TenantCtx, phone = "0550 12 34 56") =>
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
