import { describe, expect, it } from "vitest";

import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { getProjectPaymentSetup } from "@/server/payment-plans/queries";
import { saveMilestonesSchema } from "@/server/payment-plans/schemas";
import { saveMilestones } from "@/server/payment-plans/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { placeOption } from "@/server/sales/options";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema, proposeWithdrawalSchema } from "@/server/sales/schemas";
import { proposeWithdrawal } from "@/server/sales/withdrawals";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { getDashboard } from "./queries";

const today = todayInAlgiers();

async function reserveFor(ctx: TenantCtx, unitId: string, planId: string, on: string) {
  const leadId = await newLead(ctx);
  const { id: buyerId } = await createBuyer(
    ctx,
    createBuyerSchema.parse({
      lastName: "Belkadi",
      firstName: "Riad",
      phone: "0550 12 34 56",
      leadId,
    }),
  );
  return createReservation(
    ctx,
    createReservationSchema.parse({
      unitId,
      buyerIds: [buyerId],
      paymentPlanId: planId,
      discount: "",
      reservedOn: on,
      notary: "",
      reference: "",
      notes: "",
    }),
  );
}

describe("dashboard", () => {
  it("shows each member the sections and figures their roles allow", async () => {
    const team = await createSalesTeam();
    const { projectId, unitIds, planId } = await createSaleSetup(team);
    const cashier = await addMember(team.orgId, ["cashier"]);
    // A sale signed 10 days ago, partly paid by cheque: the rest of its signing share is late.
    const late = await reserveFor(team.agentA, unitIds[0], planId, addDays(today, -10));
    await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: late.id,
        amount: "602 000",
        method: "cheque",
        reference: "1",
        bank: "BNA",
        paidOn: today,
        payerName: "Riad Belkadi",
      }),
    );
    await proposeWithdrawal(
      team.manager,
      proposeWithdrawalSchema.parse({ reservationId: late.id, retention: "10", reason: "Départ" }),
    );
    const optionLead = await newLead(team.agentA, "0661 00 00 09");
    await placeOption(team.agentA, { unitId: unitIds[1], leadId: optionLead });
    // A milestone whose planned date has passed, waiting for its validation.
    const { milestones } = await getProjectPaymentSetup(team.manager, projectId);
    await saveMilestones(
      team.manager,
      saveMilestonesSchema.parse({
        projectId,
        milestones: [
          ...milestones.map((m) => ({ id: m.id, name: m.name, plannedOn: m.plannedOn ?? "" })),
          { id: "", name: "Clôture provisoire", plannedOn: addDays(today, -2) },
        ],
      }),
    );

    const owner = await getDashboard(team.owner);
    expect(owner.stock?.totals).toEqual({
      units: 3,
      available: 1,
      engaged: 2,
      sold: 0,
      unavailable: 0,
    });
    expect(owner.stock?.stockValue).toBe(2_602_000_000n);
    expect(owner.sales?.year.reservations).toEqual({ count: 1, value: 1_301_000_000n });
    expect(owner.collections).toMatchObject({
      month: 60_200_000n,
      remaining: 1_240_800_000n,
      due: 200_000_000n,
      overdue: 200_000_000n,
      overdueSales: 1,
    });
    expect(owner.todo.withdrawals).toEqual([
      expect.objectContaining({ reservationId: late.id, buyer: "Belkadi Riad" }),
    ]);
    expect(owner.todo.cheques).toEqual({ count: 1, value: 60_200_000n });
    expect(owner.todo.options?.map((o) => o.unitId)).toEqual([unitIds[1]]);
    expect(owner.todo.milestones?.map((m) => m.name)).toEqual(["Clôture provisoire"]);
    expect(owner.pipeline?.stages.won).toBe(1);

    // A commercial only counts their own sales and leads, and has no approvals.
    const other = await getDashboard(team.agentB);
    expect(other.sales?.year.reservations.count).toBe(0);
    expect(other.collections).toMatchObject({ remaining: 0n, overdueSales: 0 });
    expect(other.todo).toMatchObject({ withdrawals: null, cheques: null, milestones: null });
    expect(other.todo.options).toEqual([]);
    expect(other.pipeline?.newLeads).toBe(0);

    // The cashier follows collections and cheques, not the prospects.
    const desk = await getDashboard(cashier);
    expect(desk.pipeline).toBeNull();
    expect(desk.collections?.overdue).toBe(200_000_000n);
    expect(desk.todo.cheques?.count).toBe(1);
    expect(desk.todo.withdrawals).toBeNull();
  });
});
