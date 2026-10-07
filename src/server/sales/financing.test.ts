import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { paymentSource } from "@/lib/sales";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getSaleFinancing, saveSaleFinancing } from "./financing";
import { createReservation } from "./reservations";
import { createReservationSchema, saveSaleFinancingSchema } from "./schemas";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("financing plan of a sale", () => {
  it("counts a payment for its recorded source, else by its method", () => {
    expect(paymentSource("cash", null)).toBe("own_funds");
    expect(paymentSource("bank_loan", null)).toBe("bank_loan");
    expect(paymentSource("bank_transfer", "cnl_aid")).toBe("cnl_aid");
  });

  it("plans the sources of a sale and follows what each has brought", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Ouali",
        firstName: "Nadia",
        phone: "0661 20 30 40",
        leadId: "",
      }),
    );
    // 13 010 000 DA.
    const { id: saleId } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: today,
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    const plan = (lines: { source: string; expected: string; reference?: string }[]) =>
      saveSaleFinancingSchema.parse({
        reservationId: saleId,
        lines: lines.map((l) => ({ reference: "", ...l })),
      });
    expect(
      saveSaleFinancingSchema.safeParse({
        reservationId: saleId,
        lines: [
          { source: "own_funds", expected: "1 000", reference: "" },
          { source: "own_funds", expected: "2 000", reference: "" },
        ],
      }).success,
    ).toBe(false);
    const full = plan([
      { source: "own_funds", expected: "4 010 000" },
      { source: "bank_loan", expected: "8 000 000", reference: "BNA Hydra" },
      { source: "employer", expected: "1 000 000", reference: "Sonatrach, œuvres sociales" },
    ]);
    await expect(saveSaleFinancing(cashier, full)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A commercial only plans the sales credited to them.
    await expect(saveSaleFinancing(team.agentA, full)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      saveSaleFinancing(
        team.manager,
        plan([
          { source: "own_funds", expected: "5 000 000" },
          { source: "bank_loan", expected: "9 000 000" },
        ]),
      ),
    ).rejects.toMatchObject({ messageKey: "sales.financing.errors.abovePrice" });
    await saveSaleFinancing(team.manager, full);

    const pay = (amount: string, method: string, financingSource = "") =>
      recordPayment(
        cashier,
        recordPaymentSchema.parse({
          reservationId: saleId,
          amount,
          method,
          paidOn: today,
          reference: "",
          bank: "",
          payerName: "Nadia Ouali",
          notes: "",
          financingSource,
        }),
      );
    await pay("1 000 000", "cash");
    await pay("2 000 000", "bank_loan");
    await pay("500 000", "bank_transfer", "employer");

    const financing = await getSaleFinancing(team.manager, saleId);
    expect(financing?.lines.map((l) => [l.source, l.expected, l.received])).toEqual([
      ["own_funds", 401_000_000n, 100_000_000n],
      ["bank_loan", 800_000_000n, 200_000_000n],
      ["employer", 100_000_000n, 50_000_000n],
    ]);
    expect(financing).toMatchObject({ plannedTotal: 1_301_000_000n, unplanned: 0n });
    expect(await getSaleFinancing(team.agentA, saleId).catch((e: unknown) => e)).toMatchObject({
      code: "NOT_FOUND",
    });

    // The employer's aid dropped from the plan: what it brought stays listed, the gap shows.
    await saveSaleFinancing(
      team.manager,
      plan([
        { source: "own_funds", expected: "4 010 000" },
        { source: "bank_loan", expected: "8 000 000" },
      ]),
    );
    const after = await getSaleFinancing(team.manager, saleId);
    expect(after?.lines.find((l) => l.source === "employer")).toMatchObject({
      planned: false,
      expected: 0n,
      received: 50_000_000n,
    });
    expect(after?.unplanned).toBe(100_000_000n);

    const audits = await withTenant(team.manager, (tx) =>
      tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(and(eq(auditLog.action, "reservation.financing"), eq(auditLog.entityId, saleId))),
    );
    expect(audits).toHaveLength(2);
  });
});
