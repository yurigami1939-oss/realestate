import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { portalLink } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { getDashboard } from "@/server/dashboard/queries";
import type { PortalCtx } from "@/server/portal/context";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { closePortalRequestSchema, createPortalRequestSchema } from "./schemas";
import {
  closePortalRequest,
  createPortalRequest,
  listPortalRequests,
  listSalePortalRequests,
} from "./service";

afterAll(async () => {
  await stopEnqueue();
});

describe("portal requests", () => {
  it("lets a buyer ask about their sale and staff answer it", async () => {
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
        reservedOn: todayInAlgiers(),
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    const member = await addMember(team.orgId, ["resident"]);
    await withTenant(team.manager, (tx) =>
      tx.insert(portalLink).values({
        organizationId: team.orgId,
        email: `client-${randomUUID().slice(0, 8)}@example.test`,
        userId: member.userId,
        buyerId,
        createdBy: team.manager.userId,
      }),
    );
    const portal: PortalCtx = { userId: member.userId, orgId: team.orgId, name: "K", locale: "fr" };
    const ask = (input: Record<string, unknown>) =>
      createPortalRequestSchema.parse({
        reservationId: saleId,
        certificateKind: "",
        preferredOn: "",
        message: "",
        ...input,
      });

    expect(() => ask({ kind: "other" })).toThrow();
    expect(() => ask({ kind: "certificate" })).toThrow();
    await createPortalRequest(
      portal,
      ask({ kind: "certificate", certificateKind: "payments", message: "Pour la CNEP" }),
    );
    await expect(
      createPortalRequest(
        {
          userId: (await addMember(team.orgId, ["resident"])).userId,
          orgId: team.orgId,
          name: "X",
          locale: "fr",
        },
        ask({ kind: "other", message: "Bonjour" }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The commercial who did not make the sale does not see it; the cashier does.
    expect((await listPortalRequests(team.agentB, { status: "open", page: 1 })).rows).toEqual([]);
    const { rows } = await listPortalRequests(cashier, { status: "open", page: 1 });
    expect(rows).toEqual([
      expect.objectContaining({
        kind: "certificate",
        certificateKind: "payments",
        buyerName: "Bensalem Karim",
      }),
    ]);
    expect((await getDashboard(cashier)).todo.requests).toBe(1);

    const requestId = rows[0]?.id ?? "";
    await expect(
      closePortalRequest(
        cashier,
        closePortalRequestSchema.parse({ requestId, outcome: "declined", answer: "" }),
      ),
    ).rejects.toMatchObject({ messageKey: "requests.errors.answerRequired" });
    await closePortalRequest(
      cashier,
      closePortalRequestSchema.parse({
        requestId,
        outcome: "done",
        answer: "Attestation prête à l'accueil.",
      }),
    );
    await expect(
      closePortalRequest(
        cashier,
        closePortalRequestSchema.parse({ requestId, outcome: "done", answer: "" }),
      ),
    ).rejects.toMatchObject({ messageKey: "requests.errors.closed" });
    expect(await listSalePortalRequests(portal, saleId)).toEqual([
      expect.objectContaining({ status: "done", answer: "Attestation prête à l'accueil." }),
    ]);
    expect((await getDashboard(cashier)).todo.requests).toBe(0);
  });
});
