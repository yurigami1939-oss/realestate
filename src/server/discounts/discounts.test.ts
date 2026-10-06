import { asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, discountRequest, leadActivity } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { discountRequestState } from "@/lib/discounts";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { issueQuotationSchema } from "@/server/quotations/schemas";
import { issueQuotation } from "@/server/quotations/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { listApprovedDiscounts, listDiscountRequests, listLeadDiscountRequests } from "./queries";
import { decideDiscountSchema, requestDiscountSchema } from "./schemas";
import { cancelDiscountRequest, decideDiscount, requestDiscount } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("discount requests", () => {
  it("derives the expired state of an approved request", () => {
    expect(discountRequestState({ status: "approved", validUntil: today }, today)).toBe("approved");
    expect(
      discountRequestState({ status: "approved", validUntil: addDays(today, -1) }, today),
    ).toBe("expired");
    expect(discountRequestState({ status: "pending", validUntil: null }, today)).toBe("pending");
  });

  it("lets a commercial grant a discount a manager approved, and no more", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const [unitId, otherUnitId] = setup.unitIds;
    const leadId = await newLead(team.agentA);
    const quote = (discount: string, unit = unitId) =>
      issueQuotation(
        team.agentA,
        issueQuotationSchema.parse({
          leadId,
          unitId: unit,
          paymentPlanId: setup.planId,
          discount,
          notes: "",
        }),
      );

    // Without an approved request, a commercial cannot discount.
    await expect(quote("100 000")).rejects.toMatchObject({
      code: "FORBIDDEN",
      messageKey: "quotations.errors.discountForbidden",
    });
    // Managers decide, commercials ask; another commercial does not see the lead.
    const ask = (amount: string) =>
      requestDiscountSchema.parse({ leadId, unitId, amount, reason: "Paiement comptant 50 %" });
    await expect(requestDiscount(team.manager, ask("300 000"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(requestDiscount(team.agentB, ask("300 000"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(requestDiscount(team.agentA, ask("20 000 000"))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const { id: requestId } = await requestDiscount(team.agentA, ask("300 000"));
    await expect(requestDiscount(team.agentA, ask("200 000"))).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "discounts.errors.alreadyPending",
    });
    expect((await listDiscountRequests(team.manager, { state: "pending", page: 1 })).rows).toEqual([
      expect.objectContaining({ id: requestId, amount: 30_000_000n, state: "pending" }),
    ]);
    await expect(
      listDiscountRequests(team.agentA, { state: "pending", page: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // A rejection needs a note; the commercial cannot decide.
    const decide = (input: Record<string, unknown>) =>
      decideDiscountSchema.parse({ requestId, amount: "", note: "", ...input });
    await expect(decideDiscount(team.agentA, decide({ approve: true }))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(decideDiscount(team.manager, decide({ approve: false }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      decideDiscount(team.manager, decide({ approve: true, amount: "400 000" })),
    ).rejects.toMatchObject({ messageKey: "discounts.errors.moreThanAsked" });
    // Approved for less than asked.
    await decideDiscount(team.manager, decide({ approve: true, amount: "250 000" }));
    await expect(decideDiscount(team.manager, decide({ approve: true }))).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    const [row] = await listLeadDiscountRequests(team.agentA, leadId);
    expect(row).toMatchObject({
      state: "approved",
      approvedAmount: 25_000_000n,
      validUntil: addDays(today, 30),
    });
    expect(await listApprovedDiscounts(team.agentA, [leadId])).toEqual([
      { leadId, unitId, amount: 25_000_000n },
    ]);

    // Up to the approved amount, on this unit only.
    await expect(quote("300 000")).rejects.toMatchObject({
      code: "VALIDATION",
      messageKey: "discounts.errors.aboveApproved",
    });
    await expect(quote("100 000", otherUnitId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await quote("250 000");

    // The reservation of the lead's buyer may use it too.
    const { id: buyerId } = await createBuyer(
      team.agentA,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        leadId,
      }),
    );
    const reserve = (discount: string) =>
      createReservation(
        team.agentA,
        createReservationSchema.parse({
          unitId,
          buyerIds: [buyerId],
          paymentPlanId: setup.planId,
          discount,
          reservedOn: today,
          notary: "",
          reference: "",
          notes: "",
        }),
      );
    await expect(reserve("260 000")).rejects.toMatchObject({
      messageKey: "discounts.errors.aboveApproved",
    });
    const { id: saleId } = await reserve("250 000");

    const activities = await withTenant(team.owner, (tx) =>
      tx
        .select({ type: leadActivity.type })
        .from(leadActivity)
        .where(eq(leadActivity.leadId, leadId))
        .orderBy(asc(leadActivity.createdAt)),
    );
    expect(activities.map((a) => a.type)).toEqual(
      expect.arrayContaining(["discount_requested", "discount_decided", "reserved"]),
    );
    const audit = await withTenant(team.owner, (tx) =>
      tx.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, requestId)),
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      "discount_request.approve",
      "discount_request.create",
    ]);
    expect(saleId).toBeTruthy();
  });

  it("rejects, cancels and lets the requester withdraw only their own requests", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const leadId = await newLead(team.agentA);
    const ask = () =>
      requestDiscount(
        team.agentA,
        requestDiscountSchema.parse({
          leadId,
          unitId: setup.unitIds[0],
          amount: "500 000",
          reason: "Client fidèle",
        }),
      );
    const { id: first } = await ask();
    await decideDiscount(
      team.manager,
      decideDiscountSchema.parse({
        requestId: first,
        approve: false,
        amount: "",
        note: "Prix déjà au plus bas",
      }),
    );
    const { id: second } = await ask();
    await expect(cancelDiscountRequest(team.agentB, { requestId: second })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await cancelDiscountRequest(team.agentA, { requestId: second });
    const rows = await withTenant(team.owner, (tx) =>
      tx
        .select({ id: discountRequest.id, status: discountRequest.status })
        .from(discountRequest)
        .where(eq(discountRequest.leadId, leadId)),
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      [first]: "rejected",
      [second]: "cancelled",
    });
    expect(await listApprovedDiscounts(team.agentA, [leadId])).toEqual([]);
    expect((await listDiscountRequests(team.manager, { state: "all", page: 1 })).total).toBe(2);
  });
});
