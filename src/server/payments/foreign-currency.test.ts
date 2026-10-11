import readXlsxFile from "read-excel-file/node";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { exchangeRate, formatForeign, rateText } from "@/lib/currencies";
import { todayInAlgiers } from "@/lib/dates";
import { receiptHtml } from "@/pdf/receipt";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { buildExport } from "@/server/exports/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { loadReceiptData } from "./documents";
import { listSalePayments } from "./queries";
import { recordPaymentSchema } from "./schemas";
import { recordPayment } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const payment = (reservationId: string, overrides: Record<string, string> = {}) =>
  recordPaymentSchema.parse({
    reservationId,
    amount: "1 472 500",
    method: "bank_transfer",
    paidOn: todayInAlgiers(),
    reference: "SWIFT 7781",
    bank: "BNP Paribas",
    payerName: "Bensalem Karim",
    currency: "EUR",
    currencyAmount: "10 000",
    ...overrides,
  });

describe("payments from abroad", () => {
  it("writes amounts in a currency and the rate the bank credited", () => {
    expect(formatForeign(1_000_000n, "EUR", "fr")).toBe("10\u00a0000,00\u00a0EUR");
    expect(exchangeRate(147_250_000n, 1_000_000n)).toBe("147,2500");
    // Half-up on the fourth decimal.
    expect(exchangeRate(100n, 3n)).toBe("33,3333");
    expect(exchangeRate(200n, 3n)).toBe("66,6667");
    expect(rateText(147_250_000n, 1_000_000n, "EUR", "ar")).toBe("1 EUR = 147,2500 د.ج");
  });

  it("records a transfer in euros with its rate, on the receipt and in the journal", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "+33 6 12 34 56 78",
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

    // A currency comes by transfer, with its amount; never without one.
    expect(() => payment(saleId, { method: "cash" })).toThrow();
    expect(() => payment(saleId, { currencyAmount: "" })).toThrow();
    expect(() => payment(saleId, { currency: "", currencyAmount: "10 000" })).toThrow();
    expect(() => payment(saleId, { currency: "XYZ" })).toThrow();

    const { receiptId } = await recordPayment(cashier, payment(saleId));
    const [listed] = await listSalePayments(cashier, saleId);
    expect(listed).toMatchObject({
      amount: 147_250_000n,
      currency: "EUR",
      currencyAmount: 1_000_000n,
    });

    const loaded = await withTenant(cashier, (tx) => loadReceiptData(tx, team.orgId, receiptId));
    if (!loaded) throw new Error("receipt missing");
    expect(loaded.data.foreign).toEqual({
      fr: "10\u00a0000,00\u00a0EUR (1 EUR = 147,2500 DA)",
      ar: "10.000,00\u00a0EUR (1 EUR = 147,2500 د.ج)",
    });
    const html = receiptHtml(loaded.data);
    expect(html).toContain("Montant en devises");
    expect(html).toContain("1 EUR = 147,2500 DA");

    // The journal of collections carries the currency and its amount.
    const { bytes } = await buildExport(cashier, "collections", {}, "fr", (key: string) => key);
    const [journal] = await readXlsxFile(bytes);
    const [header = [], ...rows] = journal?.data ?? [];
    const line = rows.find((r) => r.includes("Bensalem Karim")) ?? [];
    expect(line[header.indexOf("exports.columns.currency")]).toBe("EUR");
    expect(line[header.indexOf("exports.columns.currencyAmount")]).toBe(10_000);

    const audits = await withTenant(team.owner, (tx) => tx.select().from(auditLog));
    expect(audits.find((a) => a.action === "payment.create")?.after).toMatchObject({
      currency: "EUR",
      currencyAmount: "1000000",
    });
  });
});
