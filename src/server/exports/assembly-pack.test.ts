import readXlsxFile from "read-excel-file/node";
import { afterAll, describe, expect, it } from "vitest";

import { stopEnqueue } from "@/jobs/enqueue";
import { createChargeCategory } from "@/server/charges/categories";
import { createChargeCategorySchema } from "@/server/charges/schemas";
import { createResidenceSchema } from "@/server/residences/schemas";
import { createResidence } from "@/server/residences/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { buildExport } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const t = (key: string) => key;

describe("assembly accounts pack", () => {
  it("gathers the year's budget, reserve fund, invoices and unit accounts", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const manager = await addMember(team.orgId, ["property_manager"]);
    const { id: residenceId } = await createResidence(
      manager,
      createResidenceSchema.parse({
        projectId: setup.projectId,
        name: "Résidence Les Oliviers",
        shareBasis: "10000",
        chargeFrequency: "quarterly",
        reserveFund: "5",
        callDueDays: "30",
      }),
    );
    await createChargeCategory(
      manager,
      createChargeCategorySchema.parse({
        residenceId,
        name: "Nettoyage",
        nameAr: "",
        key: "share",
        weighting: "share",
        buildingId: "",
        unitIds: [],
      }),
    );
    await expect(
      buildExport(team.agentA, "assembly_pack", { residence: residenceId, year: "2026" }, "fr", t),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { file, bytes } = await buildExport(
      manager,
      "assembly_pack",
      { residence: residenceId, year: "2026" },
      "fr",
      t,
    );
    expect(file).toMatch(/^ag-comptes-.+-2026\.xlsx$/);
    const sheets = await readXlsxFile(bytes);
    expect(sheets.map((s) => s.sheet).slice(0, 3)).toEqual([
      "charges.pack.budget",
      "charges.pack.reserve",
      "exports.sheets.invoices",
    ]);
    expect(sheets[0]?.data.map((r) => r[0])).toEqual([
      "charges.report.columns.category",
      "Nettoyage",
      "exports.total",
    ]);
    expect(sheets[1]?.data.at(-1)).toEqual(["charges.pack.reserveBalance", 0]);
  });
});
