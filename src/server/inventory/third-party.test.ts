import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { project, residenceUnit, unit, unitStatusHistory } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { createReportSchema } from "@/server/construction/schemas";
import { createConstructionReport } from "@/server/construction/service";
import { createLeadSchema } from "@/server/crm/schemas";
import { createLead } from "@/server/crm/leads";
import { saveMilestonesSchema } from "@/server/payment-plans/schemas";
import { saveMilestones } from "@/server/payment-plans/service";
import { createResidenceSchema } from "@/server/residences/schemas";
import { createResidence } from "@/server/residences/service";

import { createTenantCtx } from "../../../tests/factories";

import { createPriceList } from "./price-lists";
import { listProjectOptions } from "./queries";
import {
  createBuildingSchema,
  createPriceListSchema,
  createProjectSchema,
  createUnitSchema,
  generateUnitsSchema,
  updateProjectSchema,
  updateUnitPriceSchema,
} from "./schemas";
import {
  createBuilding,
  createProject,
  createUnit,
  generateUnits,
  updateProject,
  updateUnitPrice,
} from "./service";
import { issueUnitSheet } from "./unit-sheets";

const refused = { code: "CONFLICT", messageKey: "inventory.errors.thirdParty" };

describe("third parties' buildings", () => {
  it("keeps a building managed for others off the sales side", async () => {
    const ctx = await createTenantCtx();
    const fields = {
      code: "PALM",
      name: "Immeuble Les Palmiers",
      status: "planning",
      housingProgram: "lpa",
      thirdParty: true,
    };
    const { id: projectId } = await createProject(ctx, createProjectSchema.parse(fields));
    // Delivered and on the free market whatever the form said; the flag never changes.
    await updateProject(
      ctx,
      updateProjectSchema.parse({ ...fields, projectId, thirdParty: false, name: "Les Palmiers" }),
    );
    const [row] = await withTenant(ctx, (tx) =>
      tx.select().from(project).where(eq(project.id, projectId)),
    );
    expect(row).toMatchObject({
      name: "Les Palmiers",
      status: "delivered",
      housingProgram: "free",
      thirdParty: true,
    });

    const { id: buildingId } = await createBuilding(
      ctx,
      createBuildingSchema.parse({
        projectId,
        code: "A",
        name: "Bloc A",
        lowestFloor: "0",
        topFloor: "2",
      }),
    );
    await generateUnits(
      ctx,
      generateUnitsSchema.parse({
        buildingId,
        fromFloor: "0",
        toFloor: "1",
        unitsPerFloor: "2",
        type: "apartment",
        typology: "F3",
        livingArea: "",
      }),
    );
    const units = await withTenant(ctx, (tx) =>
      tx
        .select({ id: unit.id, status: unit.status })
        .from(unit)
        .where(eq(unit.projectId, projectId)),
    );
    expect(units).toHaveLength(4);
    expect(units.every((u) => u.status === "delivered")).toBe(true);
    const [first] = units;
    if (!first) throw new Error("no unit");
    const history = await withTenant(ctx, (tx) =>
      tx.select().from(unitStatusHistory).where(eq(unitStatusHistory.unitId, first.id)),
    );
    expect(history).toMatchObject([{ fromStatus: null, toStatus: "delivered" }]);

    // Nothing of the sales side.
    await expect(
      updateUnitPrice(
        ctx,
        updateUnitPriceSchema.parse({ unitId: first.id, price: "9 000 000", reason: "Essai" }),
      ),
    ).rejects.toMatchObject(refused);
    await expect(
      createPriceList(ctx, createPriceListSchema.parse({ projectId, name: "Grille 1" })),
    ).rejects.toMatchObject(refused);
    await expect(
      saveMilestones(ctx, saveMilestonesSchema.parse({ projectId, milestones: [] })),
    ).rejects.toMatchObject(refused);
    await expect(issueUnitSheet(ctx, { unitId: first.id })).rejects.toMatchObject(refused);
    await expect(
      createConstructionReport(
        ctx,
        createReportSchema.parse({
          projectId,
          reportedOn: todayInAlgiers(),
          title: "Visite",
          titleAr: "",
          body: "",
          bodyAr: "",
          published: false,
          progress: [],
        }),
      ),
    ).rejects.toMatchObject(refused);
    await expect(
      createLead(
        ctx,
        createLeadSchema.parse({
          fullName: "Karim Bensalem",
          phone: "0550 12 34 56",
          source: "facebook",
          typologies: [],
          projectId,
        }),
      ),
    ).rejects.toMatchObject({ messageKey: "crm.errors.projectNotFound" });
    expect((await listProjectOptions(ctx)).map((p) => p.id)).not.toContain(projectId);
    expect((await listProjectOptions(ctx, { thirdParty: true })).map((p) => p.id)).toContain(
      projectId,
    );

    // Its residence takes its units, and the units added later join it.
    const { units: enrolled, id: residenceId } = await createResidence(
      ctx,
      createResidenceSchema.parse({
        projectId,
        name: "Résidence Les Palmiers",
        shareBasis: "1000",
        chargeFrequency: "quarterly",
        reserveFund: "0",
        callDueDays: "30",
      }),
    );
    expect(enrolled).toBe(4);
    const { id: shopId } = await createUnit(
      ctx,
      createUnitSchema.parse({
        buildingId,
        code: "A-00-03",
        floor: "0",
        type: "commercial",
        isDuplex: false,
        orientations: [],
        share: "120",
      }),
    );
    const members = await withTenant(ctx, (tx) =>
      tx
        .select({ unitId: residenceUnit.unitId, share: residenceUnit.share })
        .from(residenceUnit)
        .where(eq(residenceUnit.residenceId, residenceId)),
    );
    expect(members).toHaveLength(5);
    expect(members.find((m) => m.unitId === shopId)?.share).toBe(120);
  });
});
