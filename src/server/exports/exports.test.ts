import { eq } from "drizzle-orm";
import readXlsxFile from "read-excel-file/node";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { cancelPaymentSchema, recordPaymentSchema } from "@/server/payments/schemas";
import { cancelPayment, recordPayment } from "@/server/payments/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { buildExport } from "./service";
import { buildWorkbook } from "./xlsx";

afterAll(async () => {
  await stopEnqueue();
});

/** Headers stay as their keys: the tests read the cells, not the wording. */
const t = (key: string) => key;

async function sheets(bytes: Buffer) {
  return readXlsxFile(bytes);
}

describe("spreadsheet exports", () => {
  it("writes typed cells: amounts in dinars, real dates, a frozen header row", async () => {
    const bytes = await buildWorkbook(
      [
        {
          name: "Encaissements: octobre",
          columns: [
            { header: "Date", kind: "date" },
            { header: "Montant", kind: "money" },
            { header: "Saisi le", kind: "datetime" },
            { header: "Lot", kind: "text" },
          ],
          rows: [["2026-10-05", 1_250_000_50n, new Date("2026-10-05T09:30:00Z"), "A-03-01"]],
        },
      ],
      { rightToLeft: false },
    );
    const [sheet] = await sheets(bytes);
    // Excel's forbidden characters are replaced in sheet names.
    expect(sheet?.sheet).toBe("Encaissements  octobre");
    expect(sheet?.data[0]).toEqual(["Date", "Montant", "Saisi le", "Lot"]);
    const [date, amount, at, code] = sheet?.data[1] ?? [];
    expect(amount).toBe(1_250_000.5);
    expect(date).toEqual(new Date("2026-10-05T00:00:00Z"));
    // Shown at its Algiers time (UTC+1).
    expect(at).toEqual(new Date("2026-10-05T10:30:00Z"));
    expect(code).toBe("A-03-01");
  });

  it("journals the money received with each reader's rights, and audits the export", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        email: "",
        leadId: "",
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
    const cashier = await addMember(team.orgId, ["cashier"]);
    const accountant = await addMember(team.orgId, ["accountant"]);
    const manager = await addMember(team.orgId, ["property_manager"]);
    const pay = (amount: string, method: "cash" | "bank_transfer") =>
      recordPayment(
        cashier,
        recordPaymentSchema.parse({
          reservationId: saleId,
          amount,
          method,
          paidOn: todayInAlgiers(),
          reference: method === "cash" ? "" : "VIR-12",
          payerName: "Bensalem Karim",
        }),
      );
    const kept = await pay("1 000 000", "bank_transfer");
    const voided = await pay("50 000", "cash");
    await cancelPayment(
      accountant,
      cancelPaymentSchema.parse({ paymentId: voided.paymentId, reason: "Erreur de saisie" }),
    );

    await expect(buildExport(team.agentA, "collections", {}, "fr", t)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { file, bytes } = await buildExport(accountant, "collections", {}, "fr", t);
    expect(file).toMatch(/^encaissements-\d{4}-\d{2}-01_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const [journal, summary] = await sheets(bytes);
    const rows = journal?.data.slice(1) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r[1], r[8], r[9]])).toEqual(
      expect.arrayContaining([
        [kept.receiptNumber, 1_000_000, "exports.valid"],
        [voided.receiptNumber, 50_000, "exports.cancelled"],
      ]),
    );
    expect(rows.find((r) => r[1] === voided.receiptNumber)?.[11]).toBe("Erreur de saisie");
    // The summary counts valid payments only.
    expect(summary?.data.at(-1)).toEqual(["exports.total", null, 1, 1_000_000]);

    // The gestionnaire reads payments, but not the sales: none of them in the journal.
    const residenceOnly = await buildExport(manager, "collections", {}, "fr", t);
    expect((await sheets(residenceOnly.bytes))[0]?.data).toHaveLength(1);

    const audits = await withTenant(team.owner, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, "organization.export")),
    );
    expect(audits.map((a) => a.after)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "collections", rows: 2 })]),
    );
  });

  it("exports the sales a member sees, with what is paid and what remains", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        email: "",
        leadId: "",
      }),
    );
    await createReservation(
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
    const managerExport = await buildExport(team.manager, "sales", {}, "ar", t);
    const [sales] = await sheets(managerExport.bytes);
    expect(sales?.data).toHaveLength(2);
    const [row] = sales?.data.slice(1) ?? [];
    expect(row?.[3]).toBe("Bensalem Karim");
    expect(row?.[7]).toBe(13_010_000);
    expect(row?.[8]).toBe(0);
    expect(row?.[9]).toBe(13_010_000);

    // A commercial only gets the sales credited to them (none here).
    const agentExport = await buildExport(team.agentB, "sales", {}, "fr", t);
    expect((await sheets(agentExport.bytes))[0]?.data).toHaveLength(1);

    const schedule = await buildExport(team.manager, "installments", {}, "fr", t);
    const [lines] = await sheets(schedule.bytes);
    expect(lines?.data.length).toBeGreaterThan(1);

    const stock = await buildExport(team.manager, "units", { project: setup.projectId }, "fr", t);
    expect((await sheets(stock.bytes))[0]?.data).toHaveLength(4);
    await expect(
      buildExport(team.manager, "charges", { residence: "nope" }, "fr", t),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
