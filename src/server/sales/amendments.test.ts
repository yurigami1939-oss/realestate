import { asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, file, installment, scheduleAmendment } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, addMonths, todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import {
  loadAmendmentData,
  renderAndStoreScheduleAmendment,
  scheduleAmendmentHtml,
} from "./amendment-documents";
import { listSaleAmendments, rescheduleSale } from "./amendments";
import { createReservation } from "./reservations";
import { getSale } from "./sale-queries";
import { createReservationSchema, rescheduleSaleSchema } from "./schemas";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

/** A sale of 13 010 000 DA: 20 % at signing (paid), 30 % and 50 % at two milestones. */
async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const cashier = await addMember(team.orgId, ["cashier"]);
  const { id: buyerId } = await createBuyer(
    team.manager,
    createBuyerSchema.parse({
      lastName: "Bensalem",
      firstName: "Karim",
      phone: "0550 12 34 56",
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
      reservedOn: addDays(today, -60),
      notary: "",
      reference: "",
      notes: "",
    }),
  );
  await recordPayment(
    cashier,
    recordPaymentSchema.parse({
      reservationId: saleId,
      amount: "2 602 000",
      method: "bank_transfer",
      paidOn: today,
      reference: "",
      payerName: "Bensalem Karim",
    }),
  );
  return { team, setup, saleId };
}

const monthly = (count: number, amount: string, first = addDays(today, 30)) =>
  Array.from({ length: count }, (_, i) => ({
    label: `Mensualité ${i + 1}/${count}`,
    amount,
    dueOn: addMonths(first, i),
    milestoneId: "",
  }));

describe("schedule amendments", () => {
  it("replaces the unpaid installments, keeps the paid ones and numbers each avenant", async () => {
    const { team, setup, saleId } = await scenario();
    const input = (lines: unknown[], extra: Record<string, unknown> = {}) =>
      rescheduleSaleSchema.parse({
        reservationId: saleId,
        signedOn: today,
        reason: "Difficultés passagères de l'acquéreur",
        lines,
        ...extra,
      });

    // 10 408 000 DA remain on the two milestone lines.
    await expect(rescheduleSale(team.agentA, input(monthly(4, "2 602 000")))).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    await expect(
      rescheduleSale(team.manager, input(monthly(4, "2 600 000"))),
    ).rejects.toMatchObject({ code: "VALIDATION", messageKey: "sales.errors.amendmentTotal" });
    await expect(
      rescheduleSale(team.manager, input(monthly(4, "2 602 000", addDays(today, -1)))),
    ).rejects.toMatchObject({ messageKey: "sales.errors.beforeAmendment" });
    await expect(
      rescheduleSale(team.manager, input(monthly(4, "2 602 000"), { signedOn: addDays(today, 1) })),
    ).rejects.toMatchObject({ messageKey: "sales.errors.futureDate" });

    const first = await rescheduleSale(team.manager, input(monthly(4, "2 602 000")));
    expect(first.sequence).toBe(1);
    const lines = await withTenant(team.owner, (tx) =>
      tx
        .select({
          position: installment.position,
          amount: installment.amount,
          shareBp: installment.shareBp,
          trigger: installment.trigger,
          dueOn: installment.dueOn,
        })
        .from(installment)
        .where(eq(installment.reservationId, saleId))
        .orderBy(asc(installment.position)),
    );
    expect(lines.map((l) => l.position)).toEqual([1, 4, 5, 6, 7]);
    expect(lines.reduce((sum, l) => sum + l.shareBp, 0)).toBe(10_000);
    expect(lines.slice(1).every((l) => l.trigger === "months_after_signing")).toBe(true);
    const sale = await getSale(team.manager, saleId);
    expect(sale?.statement).toMatchObject({ paid: 260_200_000n, remaining: 1_040_800_000n });
    expect(sale?.statement.lines.find((l) => l.position === 1)?.state).toBe("paid");

    // A second avenant: a milestone line not reached and dated lines.
    const [, structure] = setup.milestoneIds;
    const second = await rescheduleSale(
      team.manager,
      input([
        { label: "Gros œuvre", amount: "5 204 000", dueOn: "", milestoneId: structure },
        ...monthly(2, "2 602 000", addDays(today, 90)),
      ]),
    );
    expect(second.sequence).toBe(2);
    const amendments = await listSaleAmendments(team.manager, saleId);
    expect(amendments.map((a) => a.sequence)).toEqual([2, 1]);
    expect(amendments[1]?.lines).toHaveLength(4);

    const [row] = await withTenant(team.owner, (tx) =>
      tx.select().from(scheduleAmendment).where(eq(scheduleAmendment.id, first.id)),
    );
    expect(row).toMatchObject({ paid: 260_200_000n, sequence: 1 });
    expect(row?.replaced.map((l) => l.amount)).toEqual(["390300000", "650500000"]);
    expect(row?.replaced.map((l) => l.milestoneName)).toEqual(["Fondations", "Gros œuvre"]);
    const audit = await withTenant(team.owner, (tx) =>
      tx.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, saleId)),
    );
    expect(audit.filter((a) => a.action === "reservation.reschedule")).toHaveLength(2);
  });

  it("renders the bilingual avenant once, filed under the sale", async () => {
    const { team, saleId } = await scenario();
    const { id } = await rescheduleSale(
      team.manager,
      rescheduleSaleSchema.parse({
        reservationId: saleId,
        signedOn: today,
        reason: "Report demandé par l'acquéreur",
        lines: monthly(2, "5 204 000"),
      }),
    );
    const loaded = await withTenant(team.owner, (tx) => loadAmendmentData(tx, id));
    if (!loaded) throw new Error("amendment not found");
    const html = scheduleAmendmentHtml(loaded.data, {
      name: "El Bahdja",
      legalName: "SARL El Bahdja",
      address: null,
      wilaya: "16 - Alger",
      phone: null,
      rcNumber: null,
      nif: null,
      nis: null,
      aiNumber: null,
    });
    expect(html).toContain("AVENANT N° 1");
    expect(html).toContain("dix millions quatre cent huit mille dinars");
    expect(html).toContain('dir="rtl"');

    expect(await renderAndStoreScheduleAmendment(team.orgId, id)).toBe("stored");
    expect(await renderAndStoreScheduleAmendment(team.orgId, id)).toBe("skipped");
    const [stored] = await withTenant(team.owner, (tx) =>
      tx
        .select({ entityType: file.entityType, entityId: file.entityId })
        .from(scheduleAmendment)
        .innerJoin(file, eq(file.id, scheduleAmendment.pdfFileId))
        .where(eq(scheduleAmendment.id, id)),
    );
    expect(stored).toEqual({ entityType: "reservation", entityId: saleId });
  });
});
