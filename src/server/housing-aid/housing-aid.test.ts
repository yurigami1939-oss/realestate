import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, project } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { housingAidCheck, housingAidSettings } from "@/lib/housing-aid";
import { todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { createBankLoan, listSaleBankLoans } from "@/server/sales/bank-loans";
import { createReservation } from "@/server/sales/reservations";
import { createBankLoanSchema, createReservationSchema } from "@/server/sales/schemas";

import { createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { housingAidSchema } from "./schemas";
import { getHousingAidSettings, getSaleHousingAid, saveHousingAid } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const settings = housingAidSettings({
  snmg: "2000000",
  lpaMaxMultiple: 600,
  cnlBrackets: [
    { maxMultiple: 600, amount: "40000000" },
    { maxMultiple: 400, amount: "70000000" },
  ],
  rateBrackets: [
    { maxMultiple: 600, rateBp: 100 },
    { maxMultiple: 1200, rateBp: 300 },
  ],
});

describe("logement promotionnel aidé", () => {
  it("places a household in its bracket and lists what stands in the way", () => {
    // 60 000 DA a month = 3 × SNMG: the first bracket (sorted by ceiling).
    expect(
      housingAidCheck({ income: 6_000_000n, ownsHome: false, previousAid: false }, settings),
    ).toEqual({ multiple: 300, issues: [], cnlAid: 70_000_000n, rateBp: 100 });
    expect(
      housingAidCheck({ income: 10_000_000n, ownsHome: false, previousAid: false }, settings),
    ).toMatchObject({ multiple: 500, cnlAid: 40_000_000n, rateBp: 100 });
    // Above the ceiling: no aid, but a subsidised rate of the higher bracket.
    expect(
      housingAidCheck({ income: 16_000_000n, ownsHome: false, previousAid: false }, settings),
    ).toEqual({ multiple: 800, issues: ["incomeAbove"], cnlAid: null, rateBp: 300 });
    expect(
      housingAidCheck({ income: 6_000_000n, ownsHome: true, previousAid: true }, settings),
    ).toMatchObject({ issues: ["ownsHome", "previousAid"], cnlAid: null });
    expect(
      housingAidCheck({ income: null, ownsHome: null, previousAid: null }, settings).issues,
    ).toEqual(["incomeMissing"]);
    expect(
      housingAidCheck(
        { income: 6_000_000n, ownsHome: null, previousAid: null },
        housingAidSettings(null),
      ).issues,
    ).toEqual(["notConfigured"]);
  });

  it("checks the household of a sale in an LPA project against the settings", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const input = housingAidSchema.parse({
      snmg: "20 000",
      lpaMaxMultiple: "6",
      cnlBrackets: [
        { maxMultiple: "4", amount: "700 000" },
        { maxMultiple: "6", amount: "400 000" },
      ],
      rateBrackets: [{ maxMultiple: "6", rate: "1" }],
    });
    await expect(saveHousingAid(team.manager, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await saveHousingAid(team.owner, input);
    expect((await getHousingAidSettings(team.owner)).cnlBrackets).toEqual([
      { maxMultiple: 400, amount: 70_000_000n },
      { maxMultiple: 600, amount: 40_000_000n },
    ]);

    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Ouali",
        firstName: "Nadia",
        phone: "0661 20 30 40",
        householdIncome: "70 000",
      }),
    );
    const { id: saleId } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: todayInAlgiers(),
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    // A free-market project: no LPA check.
    expect(await getSaleHousingAid(team.manager, saleId)).toBeNull();

    await withTenant(team.owner, (tx) =>
      tx.update(project).set({ housingProgram: "lpa" }).where(eq(project.id, setup.projectId)),
    );
    expect(await getSaleHousingAid(team.manager, saleId)).toMatchObject({
      buyer: { lastName: "Ouali", income: 7_000_000n },
      check: { multiple: 350, issues: [], cnlAid: 70_000_000n, rateBp: 100 },
    });

    // The loan follows the subsidised rate.
    await createBankLoan(
      team.manager,
      createBankLoanSchema.parse({
        reservationId: saleId,
        bank: "CNEP-Banque",
        requested: "8 000 000",
        approved: "",
        status: "preparing",
        submittedOn: "",
        decidedOn: "",
        reference: "",
        notes: "",
        subsidized: true,
        rateBp: "1",
      }),
    );
    expect((await listSaleBankLoans(team.manager, saleId)).loans).toMatchObject([
      { subsidized: true, rateBp: 100 },
    ]);

    const audits = await withTenant(team.owner, (tx) =>
      tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(eq(auditLog.action, "organization.housing_aid"), eq(auditLog.entityId, team.orgId)),
        ),
    );
    expect(audits).toHaveLength(1);
  });
});
