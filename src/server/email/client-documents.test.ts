import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { organizationSetting } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { handleSendEmail } from "@/jobs/handlers/send-email";
import type { JobPayloads } from "@/jobs/queues";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { renderAndStoreReceipt } from "@/server/payments/documents";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { clientDocumentEmail } from "./templates";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const today = todayInAlgiers();

afterAll(async () => {
  await stopEnqueue();
});

/** The e-mails queued for an address, oldest first. */
async function queuedFor(to: string) {
  const { rows } = await db.execute<{ data: JobPayloads["email.send"] }>(
    sql`select data from pgboss.job where name = 'email.send' and data->>'to' = ${to} order by created_on`,
  );
  return rows.map((r) => r.data);
}

describe("documents e-mailed to clients", () => {
  it("builds a bilingual message with the PDF attached and the day to pay by", () => {
    const message = clientDocumentEmail({
      to: "karim@example.test",
      kind: "payment_call",
      name: "Karim Bensalem",
      organization: "SARL El Bahdja",
      number: "ADF-2026-000004",
      amount: 260_200_000n,
      dueOn: "2026-11-15",
      unitCode: "A-03-01",
      place: "Les Oliviers",
      attachment: {
        fileName: "ADF-2026-000004.pdf",
        storageKey: "k",
        contentType: "application/pdf",
      },
    });
    expect(message.subject).toBe("Appel de fonds ADF-2026-000004 — SARL El Bahdja · طلب دفع");
    expect(message.text).toContain("Bonjour Karim Bensalem,");
    expect(message.text).toContain("pour le lot A-03-01 (Les Oliviers)");
    expect(message.text).toContain("À régler au plus tard le 15/11/2026.");
    expect(message.html).toContain('dir="rtl"');
    expect(message.attachments).toHaveLength(1);
  });

  it("sends a sale's receipts to its buyers once the organization turns it on", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const email = `buyer-${randomUUID()}@example.test`;
    const buyer = async (firstName: string, mail: string) =>
      (
        await createBuyer(
          team.agentA,
          createBuyerSchema.parse({
            lastName: "Bensalem",
            firstName,
            phone: "0550 12 34 56",
            email: mail,
          }),
        )
      ).id;
    // Two buyers with the same address get one e-mail; one without an address none.
    const buyerIds = [await buyer("Karim", email), await buyer("Nadia", email.toUpperCase())];
    buyerIds.push(await buyer("Sami", ""));
    const { id: saleId } = await createReservation(
      team.agentA,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds,
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: addDays(today, -3),
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    const pay = (amount: string) =>
      recordPayment(
        cashier,
        recordPaymentSchema.parse({
          reservationId: saleId,
          amount,
          method: "cash",
          paidOn: today,
          payerName: "Karim Bensalem",
        }),
      );

    // Off by default: the receipt is rendered, nothing is sent.
    const first = await pay("100 000");
    expect(await renderAndStoreReceipt(team.orgId, first.receiptId)).toBe("stored");
    expect(await queuedFor(email)).toEqual([]);

    await withTenant(team.owner, (tx) =>
      tx.insert(organizationSetting).values({ organizationId: team.orgId, emailDocuments: true }),
    );
    const second = await pay("200 000");
    expect(await renderAndStoreReceipt(team.orgId, second.receiptId)).toBe("stored");
    expect(await renderAndStoreReceipt(team.orgId, second.receiptId)).toBe("skipped");
    const queued = await queuedFor(email);
    expect(queued).toHaveLength(1);
    const [message] = queued;
    if (!message) throw new Error("no e-mail queued");
    expect(message.subject).toContain(second.receiptNumber);
    expect(message.attachments).toMatchObject([
      { fileName: `${second.receiptNumber}.pdf`, contentType: "application/pdf" },
    ]);

    // The worker attaches the stored PDF.
    await handleSendEmail([
      { id: randomUUID(), name: "email.send", data: message } as Job<JobPayloads["email.send"]>,
    ]);
    const search = `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`;
    let found: { Attachments: number } | undefined;
    for (let attempt = 0; attempt < 20 && !found; attempt += 1) {
      const body = (await (await fetch(search)).json()) as { messages: { Attachments: number }[] };
      found = body.messages[0];
      if (!found) await new Promise((r) => setTimeout(r, 250));
    }
    expect(found?.Attachments).toBe(1);
  });
});
