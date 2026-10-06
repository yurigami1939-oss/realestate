import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { portalLink } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { getDashboard } from "@/server/dashboard/queries";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import type { PortalCtx } from "@/server/portal/context";
import { createReservation, recordSale } from "@/server/sales/reservations";
import { createReservationSchema, recordSaleSchema } from "@/server/sales/schemas";
import { createSupplierSchema } from "@/server/suppliers/schemas";
import { createSupplier } from "@/server/suppliers/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import {
  assignWarrantyClaimSchema,
  fixWarrantyClaimSchema,
  portalWarrantyClaimSchema,
  rejectWarrantyClaimSchema,
  reportWarrantyClaimSchema,
  scheduleHandoverSchema,
  signHandoverSchema,
} from "./schemas";
import { scheduleHandover, signHandover } from "./service";
import {
  assignWarrantyClaim,
  fixWarrantyClaim,
  listPortalWarrantyClaims,
  listWarrantyClaims,
  rejectWarrantyClaim,
  reportPortalWarrantyClaim,
  reportWarrantyClaim,
} from "./warranty";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("warranty claims", () => {
  it("records defects after the handover, passes them to a contractor and closes them", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const technical = await addMember(team.orgId, ["technical_manager"]);
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
        method: "cash",
        paidOn: addDays(today, -60),
        payerName: "Karim Bensalem",
      }),
    );
    await recordSale(
      team.manager,
      recordSaleSchema.parse({
        reservationId: saleId,
        signedOn: addDays(today, -30),
        notary: "Maître Hamidi",
        reference: "",
      }),
    );
    const { id: handoverId } = await scheduleHandover(
      technical,
      scheduleHandoverSchema.parse({
        reservationId: saleId,
        scheduledAt: `${addDays(today, 1)}T10:00`,
        notes: "",
      }),
    );
    const report = (reportedOn = today) =>
      reportWarrantyClaimSchema.parse({
        handoverId,
        location: "Salle de bains",
        description: "Fuite sous le lavabo",
        reportedOn,
      });
    // Not delivered yet: no warranty claim.
    await expect(reportWarrantyClaim(technical, report())).rejects.toMatchObject({
      messageKey: "warranty.errors.notDelivered",
    });
    await signHandover(
      technical,
      signHandoverSchema.parse({
        handoverId,
        signedOn: addDays(today, -10),
        receivedBy: "Karim Bensalem",
        keysCount: "3",
        electricityMeter: "",
        gasMeter: "",
        waterMeter: "",
        observations: "",
      }),
    );

    await expect(reportWarrantyClaim(cashier, report())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(reportWarrantyClaim(technical, report(addDays(today, -11)))).rejects.toMatchObject(
      { messageKey: "warranty.errors.beforeHandover" },
    );
    await reportWarrantyClaim(technical, report());

    // The buyer reports another one from the portal.
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
    await reportPortalWarrantyClaim(
      portal,
      portalWarrantyClaimSchema.parse({
        reservationId: saleId,
        location: "Séjour",
        description: "Fissure au plafond",
      }),
    );
    const claims = await listWarrantyClaims(technical, saleId);
    expect(claims.map((c) => [c.position, c.status, c.fromPortal])).toEqual([
      [1, "open", false],
      [2, "open", true],
    ]);
    expect((await getDashboard(technical)).todo.warrantyClaims).toHaveLength(2);

    const { id: supplierId } = await createSupplier(
      team.owner,
      createSupplierSchema.parse({ name: "Sarl Plomberie Moderne", activity: "Plomberie" }),
    );
    const [leak, crack] = claims;
    await expect(
      assignWarrantyClaim(
        technical,
        assignWarrantyClaimSchema.parse({
          claimId: leak?.id,
          warrantyKind: "completion",
          supplierId,
          dueOn: addDays(today, -1),
          note: "",
        }),
      ),
    ).rejects.toMatchObject({ messageKey: "warranty.errors.duePast" });
    await assignWarrantyClaim(
      technical,
      assignWarrantyClaimSchema.parse({
        claimId: leak?.id,
        warrantyKind: "completion",
        supplierId,
        dueOn: addDays(today, 15),
        note: "",
      }),
    );
    await fixWarrantyClaim(
      technical,
      fixWarrantyClaimSchema.parse({ claimId: leak?.id, fixedOn: today, note: "Siphon changé" }),
    );
    await expect(
      fixWarrantyClaim(
        technical,
        fixWarrantyClaimSchema.parse({ claimId: leak?.id, fixedOn: today }),
      ),
    ).rejects.toMatchObject({ messageKey: "warranty.errors.notAssigned" });
    await rejectWarrantyClaim(
      technical,
      rejectWarrantyClaimSchema.parse({
        claimId: crack?.id,
        note: "Fissure de retrait du plâtre, sans désordre de structure",
      }),
    );

    expect(await listPortalWarrantyClaims(portal, saleId)).toEqual([
      expect.objectContaining({ position: 1, status: "fixed", fixedOn: today, note: null }),
      expect.objectContaining({
        position: 2,
        status: "rejected",
        note: "Fissure de retrait du plâtre, sans désordre de structure",
      }),
    ]);
    expect((await getDashboard(technical)).todo.warrantyClaims).toEqual([]);
  });
});
