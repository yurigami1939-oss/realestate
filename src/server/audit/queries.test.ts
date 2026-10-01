import { describe, expect, it } from "vitest";

import { addDays, todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { listAuditActors, listAuditLog } from "./queries";
import { auditListParams } from "./schemas";

const today = todayInAlgiers();

describe("audit log", () => {
  it("lists who did what, links each record and filters by record, member and day", async () => {
    const team = await createSalesTeam();
    const { projectId, unitIds, planId } = await createSaleSetup(team);
    const accountant = await addMember(team.orgId, ["accountant"]);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const leadId = await newLead(team.agentA);
    const { id: buyerId } = await createBuyer(
      team.agentA,
      createBuyerSchema.parse({
        lastName: "Rahmani",
        firstName: "Imane",
        phone: "0550 12 34 56",
        leadId,
      }),
    );
    const { id: saleId } = await createReservation(
      team.agentA,
      createReservationSchema.parse({
        unitId: unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: planId,
        discount: "",
        reservedOn: today,
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    const { paymentId } = await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount: "100 000",
        method: "cash",
        paidOn: today,
        payerName: "Imane Rahmani",
      }),
    );
    const list = (params: Record<string, string>) =>
      listAuditLog(accountant, auditListParams.parse(params));

    await expect(list({})).resolves.toMatchObject({ page: 1 });
    await expect(listAuditLog(team.manager, auditListParams.parse({}))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(listAuditLog(cashier, auditListParams.parse({}))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const all = await list({});
    expect(all.rows[0]).toMatchObject({
      action: "payment.create",
      actorUserId: cashier.userId,
      href: `/sales/${saleId}`,
    });
    expect(all.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["reservation.create", "unit.status_change", "unit.price_change"]),
    );

    const sales = await list({ entityType: "reservation" });
    expect(sales.rows).toEqual([
      expect.objectContaining({ action: "reservation.create", href: `/sales/${saleId}` }),
    ]);
    const unitHistory = await list({ entityType: "unit", entityId: unitIds[0] });
    expect(unitHistory.rows.map((r) => r.action)).toEqual([
      "unit.status_change",
      "unit.price_change",
    ]);
    expect(unitHistory.rows[0]?.href).toBe(`/projects/${projectId}/units/${unitIds[0]}`);
    expect((await list({ entityId: paymentId })).rows[0]?.after).toMatchObject({
      amount: "10000000",
      method: "cash",
    });

    const byAgent = await list({ actorUserId: team.agentA.userId });
    expect(byAgent.rows.every((r) => r.actorUserId === team.agentA.userId)).toBe(true);
    expect(byAgent.total).toBeGreaterThan(0);
    expect((await list({ from: today, to: today })).total).toBe(all.total);
    expect((await list({ from: addDays(today, 1) })).total).toBe(0);
    expect((await list({ to: addDays(today, -1) })).total).toBe(0);

    // Another organization's trail stays out of sight.
    const other = await createSalesTeam();
    await createSaleSetup(other);
    expect((await list({})).total).toBe(all.total);

    expect((await listAuditActors(accountant)).map((a) => a.userId)).toEqual(
      expect.arrayContaining([team.owner.userId, team.agentA.userId, cashier.userId]),
    );
  });
});
