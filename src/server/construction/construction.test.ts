import { describe, expect, it } from "vitest";

import { addDays, todayInAlgiers } from "@/lib/dates";
import { getFileDownloadUrl } from "@/server/files/service";
import { createBuildingSchema } from "@/server/inventory/schemas";
import { createBuilding } from "@/server/inventory/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getProjectConstruction, listConstructionOverview } from "./queries";
import { createReportSchema, MAX_REPORT_PHOTOS, updateReportSchema } from "./schemas";
import {
  addReportPhoto,
  createConstructionReport,
  deleteConstructionReport,
  removeReportPhoto,
  updateConstructionReport,
} from "./service";

const today = todayInAlgiers();
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const photo = (fileName = "chantier.jpg") => ({ fileName, bytes: jpeg() });

/** The sales fixture project (Bloc A) with a second building and a responsable technique. */
async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const { id: blockB } = await createBuilding(
    team.owner,
    createBuildingSchema.parse({
      projectId: setup.projectId,
      code: "B",
      name: "Bloc B",
      lowestFloor: "0",
      topFloor: "5",
    }),
  );
  const technical = await addMember(team.orgId, ["technical_manager"]);
  return { team, setup, blockA: setup.buildingId, blockB, technical };
}

const report = (
  projectId: string,
  progress: { buildingId: string; percent: string }[],
  overrides: Record<string, unknown> = {},
) =>
  createReportSchema.parse({
    projectId,
    reportedOn: addDays(today, -7),
    title: "Gros œuvre",
    titleAr: "",
    body: "Coulage de la dalle du 5e étage.",
    bodyAr: "",
    published: true,
    progress,
    ...overrides,
  });

describe("construction follow-up", () => {
  it("records dated reports and keeps each building's latest progress", async () => {
    const { team, setup, blockA, blockB, technical } = await scenario();
    const other = await scenario();

    // Commercials and the directeur commercial follow the works; the technical team reports.
    for (const ctx of [team.agentA, team.manager]) {
      await expect(
        createConstructionReport(ctx, report(setup.projectId, [])),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(
      createConstructionReport(
        technical,
        report(setup.projectId, [], { reportedOn: addDays(today, 1) }),
      ),
    ).rejects.toMatchObject({ messageKey: "construction.errors.futureDate" });
    await expect(
      createConstructionReport(
        technical,
        report(setup.projectId, [{ buildingId: other.blockA, percent: "10" }]),
      ),
    ).rejects.toMatchObject({ messageKey: "construction.errors.buildingNotFound" });

    await createConstructionReport(
      technical,
      report(
        setup.projectId,
        [
          { buildingId: blockA, percent: "40" },
          { buildingId: blockB, percent: "" },
        ],
        { title: "Fondations", reportedOn: addDays(today, -30) },
      ),
    );
    const { id: latest } = await createConstructionReport(
      technical,
      report(
        setup.projectId,
        [
          { buildingId: blockA, percent: "55" },
          { buildingId: blockB, percent: "20" },
        ],
        { published: false },
      ),
    );
    // An older report entered afterwards does not replace the current progress.
    await createConstructionReport(
      technical,
      report(setup.projectId, [{ buildingId: blockA, percent: "30" }], {
        title: "Terrassement",
        reportedOn: addDays(today, -60),
      }),
    );

    const view = await getProjectConstruction(team.agentA, setup.projectId);
    expect(view?.buildings.map((b) => [b.name, b.progress])).toEqual([
      ["Bloc A", { percent: 55, reportedOn: addDays(today, -7) }],
      ["Bloc B", { percent: 20, reportedOn: addDays(today, -7) }],
    ]);
    expect(view?.reports.map((r) => [r.title, r.published])).toEqual([
      ["Gros œuvre", false],
      ["Fondations", true],
      ["Terrassement", true],
    ]);
    expect(view?.reports[0]?.progress).toEqual([
      { buildingId: blockA, buildingName: "Bloc A", percent: 55 },
      { buildingId: blockB, buildingName: "Bloc B", percent: 20 },
    ]);
    expect(
      (await getProjectConstruction(team.agentA, setup.projectId, { limit: 1 }))?.reports,
    ).toHaveLength(1);

    // A report is rewritten as a whole: a building left blank is no longer reported.
    await updateConstructionReport(
      technical,
      updateReportSchema.parse({
        reportId: latest,
        reportedOn: addDays(today, -7),
        title: "Gros œuvre",
        titleAr: "الهيكل",
        body: "",
        bodyAr: "",
        published: true,
        progress: [
          { buildingId: blockA, percent: "60" },
          { buildingId: blockB, percent: "" },
        ],
      }),
    );
    let current = await getProjectConstruction(technical, setup.projectId);
    expect(current?.buildings.map((b) => b.progress?.percent ?? null)).toEqual([60, null]);

    await deleteConstructionReport(technical, latest);
    await expect(deleteConstructionReport(technical, latest)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    current = await getProjectConstruction(technical, setup.projectId);
    expect(current?.buildings[0]?.progress).toEqual({
      percent: 40,
      reportedOn: addDays(today, -30),
    });
    expect(current?.totalReports).toBe(2);

    expect(await listConstructionOverview(team.owner)).toMatchObject([
      {
        name: "Résidence Les Oliviers",
        reports: 2,
        lastReportOn: addDays(today, -30),
        milestones: 2,
        milestonesDone: 0,
        nextMilestone: { name: "Fondations" },
      },
    ]);
    // Another organization sees nothing of it.
    expect(await getProjectConstruction(other.technical, setup.projectId)).toBeNull();
    await expect(deleteConstructionReport(other.technical, latest)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("keeps site photos per report, readable by the staff", async () => {
    const { team, setup, technical } = await scenario();
    const { id: reportId } = await createConstructionReport(technical, report(setup.projectId, []));

    await expect(addReportPhoto(team.agentA, { reportId, upload: photo() })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      addReportPhoto(technical, {
        reportId,
        upload: { fileName: "plan.pdf", bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF") },
      }),
    ).rejects.toMatchObject({ messageKey: "files.errors.type" });

    const { fileId } = await addReportPhoto(technical, { reportId, upload: photo() });
    let view = await getProjectConstruction(technical, setup.projectId);
    expect(view?.reports[0]?.photos).toEqual([{ id: fileId, fileName: "chantier.jpg" }]);
    expect(await getFileDownloadUrl(team.agentA, fileId, "inline")).toMatch(/^http/);

    await removeReportPhoto(technical, { reportId, fileId });
    await expect(removeReportPhoto(technical, { reportId, fileId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    view = await getProjectConstruction(technical, setup.projectId);
    expect(view?.reports[0]?.photos).toEqual([]);

    for (let i = 0; i < MAX_REPORT_PHOTOS; i++) {
      await addReportPhoto(technical, { reportId, upload: photo(`vue-${i}.jpg`) });
    }
    await expect(addReportPhoto(technical, { reportId, upload: photo() })).rejects.toMatchObject({
      messageKey: "construction.errors.tooManyPhotos",
    });

    // Deleting the report takes its photos away.
    const kept = (await getProjectConstruction(technical, setup.projectId))?.reports[0]?.photos;
    await deleteConstructionReport(technical, reportId);
    await expect(
      getFileDownloadUrl(team.agentA, kept?.[0]?.id ?? "", "inline"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
