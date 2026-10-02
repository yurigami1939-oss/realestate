import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { auditLog, installment, paymentCall } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { paymentCallHtml, renderAndStorePaymentCall } from "./documents";
import { listSalePaymentCalls } from "./queries";
import { validateMilestoneSchema } from "./schemas";
import { issueMilestonePaymentCalls, validateMilestone } from "./service";

const today = todayInAlgiers();

async function sale(ctx: TenantCtx, unitId: string, planId: string, nin: string, on: string) {
  const phone = `0550 00 ${nin.slice(-4, -2)} ${nin.slice(-2)}`;
  const leadId = await newLead(ctx, phone);
  const { id: buyerId } = await createBuyer(
    ctx,
    createBuyerSchema.parse({ lastName: "Haddad", firstName: "Nadia", nin, phone, leadId }),
  );
  return (
    await createReservation(
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
    )
  ).id;
}

const pay = (ctx: TenantCtx, reservationId: string, amount: string) =>
  recordPayment(
    ctx,
    recordPaymentSchema.parse({
      reservationId,
      amount,
      method: "cash",
      paidOn: today,
      payerName: "Nadia Haddad",
    }),
  );

const dueOn = async (ctx: TenantCtx, reservationId: string, position: number) =>
  (
    await withTenant(ctx, (tx) =>
      tx
        .select({ dueOn: installment.dueOn })
        .from(installment)
        .where(
          and(eq(installment.reservationId, reservationId), eq(installment.position, position)),
        ),
    )
  )[0]?.dueOn;

describe("milestone validation and payment calls", () => {
  it("date the milestone's installments and call what is unpaid, once per installment", async () => {
    const team = await createSalesTeam();
    const { unitIds, planId, milestoneIds } = await createSaleSetup(team);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const signedOn = addDays(today, -40);
    const partly = await sale(team.agentA, unitIds[0], planId, "109085198500100001", signedOn);
    const ahead = await sale(team.agentA, unitIds[1], planId, "109085198500100002", signedOn);
    // 20 % + 1 000 000 DA on the first sale; 50 % (reservation and foundations) on the second.
    await pay(cashier, partly, "3 602 000");
    await pay(cashier, ahead, "6 505 000");

    const input = validateMilestoneSchema.parse({
      milestoneId: milestoneIds[0],
      validatedOn: addDays(today, -30),
    });
    await expect(validateMilestone(team.agentA, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      validateMilestone(team.manager, { ...input, validatedOn: addDays(today, 1) }),
    ).rejects.toMatchObject({ messageKey: "sales.errors.futureDate" });
    expect(await validateMilestone(team.manager, input)).toEqual({
      dueOn: addDays(today, -15),
      installments: 2,
    });
    await expect(validateMilestone(team.manager, input)).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "paymentPlans.errors.alreadyValidated",
    });

    expect(await dueOn(team.manager, partly, 2)).toBe(addDays(today, -15));
    expect(await dueOn(team.manager, partly, 3)).toBeNull();
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pgboss.job
          where name = 'payment_call.issue' and data->>'milestoneId' = ${milestoneIds[0]}`,
    );
    expect(rows[0]?.n).toBe(1);
    const [audit] = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action, actor: auditLog.actorUserId })
        .from(auditLog)
        .where(eq(auditLog.entityId, milestoneIds[0])),
    );
    expect(audit).toEqual({ action: "milestone.validate", actor: team.manager.userId });

    expect(await issueMilestonePaymentCalls(team.orgId, milestoneIds[0])).toBe(1);
    expect(await issueMilestonePaymentCalls(team.orgId, milestoneIds[0])).toBe(0);
    const calls = await listSalePaymentCalls(team.agentA, partly);
    expect(calls).toEqual([
      expect.objectContaining({
        number: `ADF-${today.slice(0, 4)}-000001`,
        label: "Fondations",
        milestoneName: "Fondations",
        called: 290_300_000n,
        dueOn: addDays(today, -15),
      }),
    ]);
    expect(await listSalePaymentCalls(team.agentA, ahead)).toEqual([]);
    expect(await listSalePaymentCalls(team.agentB, partly)).toEqual([]);

    // A sale signed after the milestone was reached owes it at signing, not before.
    const late = await sale(team.manager, unitIds[2], planId, "109085198500100003", today);
    expect(await dueOn(team.manager, late, 2)).toBe(today);

    // Issued calls are never edited or deleted.
    const callId = calls[0]?.id ?? "";
    await expect(
      withTenant(team.owner, (tx) =>
        tx.update(paymentCall).set({ called: 1n }).where(eq(paymentCall.id, callId)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(team.owner, (tx) => tx.delete(paymentCall).where(eq(paymentCall.id, callId))),
    ).rejects.toThrow();
  });

  it("render a bilingual payment call once", async () => {
    const team = await createSalesTeam();
    const { unitIds, planId, milestoneIds } = await createSaleSetup(team);
    const saleId = await sale(team.agentA, unitIds[0], planId, "109085198500100004", today);
    await validateMilestone(
      team.owner,
      validateMilestoneSchema.parse({ milestoneId: milestoneIds[0], validatedOn: today }),
    );
    await issueMilestonePaymentCalls(team.orgId, milestoneIds[0]);
    const [call] = await listSalePaymentCalls(team.owner, saleId);

    expect(await renderAndStorePaymentCall(team.orgId, call?.id ?? "")).toBe("stored");
    expect(await renderAndStorePaymentCall(team.orgId, call?.id ?? "")).toBe("skipped");
    const [stored] = await listSalePaymentCalls(team.owner, saleId);
    expect(stored?.pdfFileId).not.toBeNull();

    const html = paymentCallHtml(
      {
        number: "ADF-2026-000001",
        issuedAt: new Date("2026-10-01T09:00:00Z"),
        saleNumber: "RES-2026-000001",
        saleDeedNumber: null,
        projectName: "Résidence Les Oliviers",
        buildingName: "Bloc A",
        unitCode: "A-03-01",
        milestoneName: "Fondations",
        validatedOn: "2026-10-01",
        label: "Fondations",
        amount: 390_300_000n,
        settled: 0n,
        called: 390_300_000n,
        dueOn: "2026-10-16",
        buyers: [{ name: "Haddad Nadia", nameAr: "حداد نادية", address: "" }],
      },
      {
        name: "Promo",
        legalName: "SARL Promo",
        address: null,
        wilaya: null,
        phone: null,
        rcNumber: null,
        nif: null,
        nis: null,
        aiNumber: null,
      },
    );
    expect(html).toContain("APPEL DE FONDS");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('<bdi dir="rtl" lang="ar">حداد نادية</bdi>');
    expect(html).toContain("trois millions neuf cent trois mille dinars");
    expect(html).toContain("16/10/2026");
  });
});
