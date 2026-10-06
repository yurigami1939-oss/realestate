import readXlsxFile from "read-excel-file/node";
import { afterAll, describe, expect, it } from "vitest";

import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { ageingBucket, monthsOfPeriod } from "@/lib/reports";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { buildExport } from "@/server/exports/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getReports } from "./queries";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("reports", () => {
  it("buckets receivables by age and lists the months of a period", () => {
    expect(ageingBucket(null, "2026-10-06")).toBe("undated");
    expect(ageingBucket("2026-10-06", "2026-10-06")).toBe("not_due");
    expect(ageingBucket("2026-10-05", "2026-10-06")).toBe("d0_30");
    expect(ageingBucket("2026-08-07", "2026-10-06")).toBe("d31_60");
    expect(ageingBucket("2026-03-01", "2026-10-06")).toBe("over_180");
    expect(monthsOfPeriod("2026-11-15", "2027-01-31")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(monthsOfPeriod("2026-11-15", null, 2)).toEqual(["2026-11", "2026-12"]);
  });

  it("reports sales, commercials, receivables, expected collections and stock", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const accountant = await addMember(team.orgId, ["accountant"]);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const { id: buyerId } = await createBuyer(
      team.agentA,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        leadId: "",
      }),
    );
    // A sale signed 40 days ago: its signing installment (20 %) is 40 days late, then paid half.
    const { id: saleId } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: addDays(today, -40),
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount: "1 301 000",
        method: "bank_transfer",
        paidOn: today,
        reference: "",
        payerName: "Bensalem Karim",
      }),
    );
    await expect(getReports(team.agentA, {})).rejects.toMatchObject({ code: "FORBIDDEN" });

    const r = await getReports(accountant, { from: addDays(today, -60), to: today });
    expect(r.totals).toMatchObject({
      reservations: 1,
      reserved: 1_301_000_000n,
      collected: 130_100_000n,
    });
    // 13 010 000 DA for 86,75 m²: 149 971,18 DA per m².
    expect(r.byTypology).toEqual([
      expect.objectContaining({
        typology: "F3",
        count: 1,
        value: 1_301_000_000n,
        perSquareMeter: 14_997_118n,
      }),
    ]);
    expect(r.commercials).toEqual([
      expect.objectContaining({
        userId: team.agentA.userId,
        reservations: 1,
        collected: 130_100_000n,
      }),
    ]);
    expect(r.ageing).toMatchObject({ d31_60: 130_100_000n, undated: 1_040_800_000n });
    expect(r.forecast[0]?.expected).toBe(130_100_000n);
    expect(r.stock).toEqual([
      expect.objectContaining({
        typology: "F3",
        available: 2,
        reserved: 1,
        value: 2_602_000_000n,
      }),
    ]);

    const { bytes } = await buildExport(
      accountant,
      "report",
      { from: addDays(today, -60), to: today },
      "fr",
      (key) => key,
    );
    const sheets = await readXlsxFile(bytes);
    expect(sheets.map((s) => s.sheet)).toEqual([
      "reports.byMonth.title",
      "reports.byTypology.title",
      "reports.commercials.title",
      "reports.ageing.title",
      "reports.forecast.title",
      "reports.stock.title",
    ]);
  });
});
