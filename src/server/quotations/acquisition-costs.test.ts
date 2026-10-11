import { afterAll, describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { quotationHtml } from "@/pdf/quotation";
import { acquisitionCostsSchema } from "@/server/organizations/schemas";
import { saveAcquisitionCosts } from "@/server/organizations/settings";

import { createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { getAcquisitionCostSettings, getQuotation, loadQuotationDocument } from "./queries";
import { issueQuotationSchema } from "./schemas";
import { issueQuotation } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const DA = (dinars: number) => BigInt(dinars) * 100n;

const figures = (overrides: Record<string, unknown> = {}) =>
  acquisitionCostsSchema.parse({
    tranches: [
      { upTo: "2 000 000", rate: "2" },
      { upTo: "5 000 000", rate: "1,5" },
      { upTo: "", rate: "1" },
    ],
    notaryVat: "19",
    registration: "5",
    publication: "1",
    fixedFees: "15 000",
    ...overrides,
  });

describe("estimated acquisition costs on quotations", () => {
  it("estimates a buyer's costs at issue, with the gérant's figures", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const leadId = await newLead(team.agentA);
    const issue = () =>
      issueQuotation(
        team.agentA,
        issueQuotationSchema.parse({
          leadId,
          unitId: setup.unitIds[0],
          paymentPlanId: setup.planId,
          discount: "",
          notes: "",
        }),
      );

    // Nothing set: nothing estimated, nothing printed.
    const plain = await issue();
    expect((await getQuotation(team.agentA, plain.id))?.costs).toBeNull();

    // The gérant's figures; tranches in order, the open one last.
    await expect(saveAcquisitionCosts(team.manager, figures())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(() =>
      figures({
        tranches: [
          { upTo: "", rate: "1" },
          { upTo: "2 000 000", rate: "2" },
        ],
      }),
    ).toThrow();
    expect(() =>
      figures({
        tranches: [
          { upTo: "5 000 000", rate: "2" },
          { upTo: "2 000 000", rate: "1" },
        ],
      }),
    ).toThrow();
    await saveAcquisitionCosts(team.owner, figures());
    expect(await getAcquisitionCostSettings(team.agentA)).toMatchObject({
      registrationBp: 500,
      fixedFees: DA(15_000),
    });

    // 13 010 000 DA: 2 % of 2 M, 1,5 % of 3 M, 1 % of the rest; VAT, duties and fixed costs.
    const { id } = await issue();
    const expected = {
      notaryFees: DA(40_000 + 45_000 + 80_100),
      notaryVat: DA(31_369),
      registration: DA(650_500),
      publication: DA(130_100),
      fixedFees: DA(15_000),
      total: DA(165_100 + 31_369 + 650_500 + 130_100 + 15_000),
    };
    expect((await getQuotation(team.agentA, id))?.costs).toEqual(expected);

    // Printed on the PDF; later figures never change an issued quotation.
    const doc = await withTenant(team.owner, (tx) => loadQuotationDocument(tx, team.orgId, id));
    if (!doc) throw new Error("quotation missing");
    const html = quotationHtml(doc);
    expect(html).toContain("Frais d’acquisition estimés");
    expect(html).toContain("مصاريف الاقتناء التقديرية");
    await saveAcquisitionCosts(
      team.owner,
      figures({ tranches: [], notaryVat: "", registration: "", publication: "", fixedFees: "" }),
    );
    expect((await getQuotation(team.agentA, id))?.costs).toEqual(expected);
    expect((await getAcquisitionCostSettings(team.agentA)).registrationBp).toBe(0);

    const audits = await withTenant(team.owner, (tx) => tx.select().from(auditLog));
    expect(audits.filter((a) => a.action === "organization.acquisition_costs")).toHaveLength(2);
  });
});
