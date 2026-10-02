import { describe, expect, it } from "vitest";

import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { companySettingsSchema } from "@/server/organizations/schemas";
import { updateCompanySettings } from "@/server/organizations/settings";
import { createReservation, recordSale } from "@/server/sales/reservations";
import { createReservationSchema, recordSaleSchema } from "@/server/sales/schemas";

import { addMember, companySettingsInput, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { getCommissionRates, listCommissionEarners, listCommissions } from "./queries";
import { commissionListParams, commissionRatesSchema } from "./schemas";
import { payCommission, saveCommissionRates } from "./service";

const today = todayInAlgiers();

/** A VSP signed today for a buyer of `ctx`'s lead on `unitId`; returns the reservation id. */
async function soldBy(
  ctx: TenantCtx,
  manager: TenantCtx,
  unitId: string,
  planId: string,
  nin: string,
) {
  const phone = `0550 03 ${nin.slice(-4, -2)} ${nin.slice(-2)}`;
  const leadId = await newLead(ctx, phone);
  const { id: buyerId } = await createBuyer(
    ctx,
    createBuyerSchema.parse({ lastName: "Hamidi", firstName: "Rym", nin, phone, leadId }),
  );
  const { id } = await createReservation(
    ctx,
    createReservationSchema.parse({
      unitId,
      buyerIds: [buyerId],
      paymentPlanId: planId,
      discount: "",
      reservedOn: today,
      notary: "",
      reference: "",
      notes: "",
    }),
  );
  await recordSale(
    manager,
    recordSaleSchema.parse({
      reservationId: id,
      signedOn: today,
      notary: "Maître Kaci",
      reference: "",
    }),
  );
  return id;
}

describe("commissions", () => {
  it("are listed per commercial and paid once by the accountant", async () => {
    const team = await createSalesTeam();
    const { unitIds, planId } = await createSaleSetup(team);
    const accountant = await addMember(team.orgId, ["accountant"]);
    await updateCompanySettings(
      team.owner,
      companySettingsSchema.parse(companySettingsInput({ defaultCommissionRate: "1" })),
    );
    await soldBy(team.agentA, team.manager, unitIds[0], planId, "109085198500400001");
    await soldBy(team.agentB, team.manager, unitIds[1], planId, "109085198500400002");
    const all = commissionListParams.parse({});

    const mine = await listCommissions(team.agentA, all);
    expect(mine.rows.map((r) => [r.userId, r.amount, r.status])).toEqual([
      [team.agentA.userId, 13_010_000n, "earned"],
    ]);
    expect(mine.earned).toBe(13_010_000n);
    const everyone = await listCommissions(team.manager, all);
    expect(everyone.total).toBe(2);
    expect(everyone.earned).toBe(26_020_000n);
    expect(
      (
        await listCommissions(
          team.manager,
          commissionListParams.parse({ userId: team.agentB.userId }),
        )
      ).total,
    ).toBe(1);

    const commissionId = mine.rows[0]?.id ?? "";
    await expect(
      payCommission(team.manager, { commissionId, paidOn: today }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      payCommission(accountant, { commissionId, paidOn: addDays(today, -1) }),
    ).rejects.toMatchObject({ messageKey: "commissions.errors.beforeEarned" });
    await payCommission(accountant, { commissionId, paidOn: today });
    await expect(payCommission(accountant, { commissionId, paidOn: today })).rejects.toMatchObject({
      messageKey: "commissions.errors.notEarned",
    });

    const after = await listCommissions(accountant, all);
    expect(after).toMatchObject({ earned: 13_010_000n, paid: 13_010_000n });
    expect(
      (await listCommissions(accountant, commissionListParams.parse({ status: "paid" }))).rows,
    ).toEqual([expect.objectContaining({ id: commissionId, paidOn: today })]);
  });

  it("use the rate set per commercial, else the company default", async () => {
    const team = await createSalesTeam();
    const { unitIds, planId } = await createSaleSetup(team);
    const cashier = await addMember(team.orgId, ["cashier"]);
    await updateCompanySettings(
      team.owner,
      companySettingsSchema.parse(companySettingsInput({ defaultCommissionRate: "1" })),
    );
    const input = commissionRatesSchema.parse({
      rates: [
        { userId: team.agentA.userId, rate: "1,5" },
        { userId: team.agentB.userId, rate: "" },
      ],
    });

    await expect(saveCommissionRates(team.manager, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      saveCommissionRates(
        team.owner,
        commissionRatesSchema.parse({ rates: [{ userId: cashier.userId, rate: "2" }] }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await saveCommissionRates(team.owner, input);

    const rates = await getCommissionRates(team.owner);
    expect(rates.defaultRateBp).toBe(100);
    expect(rates.rows.find((r) => r.userId === team.agentA.userId)?.rateBp).toBe(150);
    expect(rates.rows.find((r) => r.userId === team.agentB.userId)?.rateBp).toBeNull();
    expect((await listCommissionEarners(team.manager)).map((e) => e.userId)).not.toContain(
      cashier.userId,
    );

    await soldBy(team.agentA, team.manager, unitIds[0], planId, "109085198500400003");
    await soldBy(team.agentB, team.manager, unitIds[1], planId, "109085198500400004");
    const { rows } = await listCommissions(team.owner, commissionListParams.parse({}));
    expect(Object.fromEntries(rows.map((r) => [r.userId, r.rateBp]))).toEqual({
      [team.agentA.userId]: 150,
      [team.agentB.userId]: 100,
    });

    // Back to the default.
    await saveCommissionRates(
      team.owner,
      commissionRatesSchema.parse({ rates: [{ userId: team.agentA.userId, rate: "" }] }),
    );
    expect(
      (await getCommissionRates(team.owner)).rows.find((r) => r.userId === team.agentA.userId)
        ?.rateBp,
    ).toBeNull();
  });
});
