import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { reservationAnnex, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { scheduleHandoverSchema, signHandoverSchema } from "@/server/handovers/schemas";
import { scheduleHandover, signHandover } from "@/server/handovers/service";
import { createUnitSchema, updateUnitPriceSchema } from "@/server/inventory/schemas";
import { createUnit, updateUnitPrice } from "@/server/inventory/service";

import { createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { createReservation, recordSale } from "./reservations";
import { getSale, getUnitSale } from "./sale-queries";
import {
  createReservationSchema,
  decideWithdrawalSchema,
  proposeWithdrawalSchema,
  recordSaleSchema,
  swapUnitSchema,
} from "./schemas";
import { swapUnit } from "./changes";
import { decideWithdrawal, proposeWithdrawal } from "./withdrawals";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

async function annexUnit(
  ctx: TenantCtx,
  buildingId: string,
  code: string,
  type: "parking" | "storage",
  price: string | null,
) {
  const { id } = await createUnit(
    ctx,
    createUnitSchema.parse({
      buildingId,
      code,
      floor: "0",
      type,
      typology: "",
      isDuplex: false,
      livingArea: "",
      usableArea: "12,50",
      orientations: [],
    }),
  );
  if (price) {
    await updateUnitPrice(
      ctx,
      updateUnitPriceSchema.parse({ unitId: id, price, reason: "Grille" }),
    );
  }
  return id;
}

const statusOf = async (ctx: TenantCtx, ids: string[]) =>
  (
    await withTenant(ctx, (tx) =>
      tx.select({ id: unit.id, status: unit.status }).from(unit).where(inArray(unit.id, ids)),
    )
  )
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
    .map((u) => u.status);

describe("several units in one contract", () => {
  it("sells annexes with the main unit, through the VSP, a swap, a withdrawal and the handover", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const parking = await annexUnit(
      team.manager,
      setup.buildingId,
      "A-00-P1",
      "parking",
      "1 800 000",
    );
    const cellar = await annexUnit(team.manager, setup.buildingId, "A-00-C1", "storage", "650 000");
    const unpriced = await annexUnit(team.manager, setup.buildingId, "A-00-C2", "storage", null);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({ lastName: "Ouali", firstName: "Nadia", phone: "0661 20 30 40" }),
    );
    const reserve = (unitId: string, annexUnitIds: string[], discount = "") =>
      createReservation(
        team.manager,
        createReservationSchema.parse({
          unitId,
          annexUnitIds,
          buyerIds: [buyerId],
          paymentPlanId: setup.planId,
          discount,
          reservedOn: today,
          notary: "",
          reference: "",
          notes: "",
        }),
      );
    const [first, second, third] = setup.unitIds;

    await expect(reserve(first, [first])).rejects.toMatchObject({
      messageKey: "sales.annexes.errors.duplicate",
    });
    await expect(reserve(first, [parking, parking])).rejects.toMatchObject({
      messageKey: "sales.annexes.errors.duplicate",
    });
    await expect(reserve(first, [unpriced])).rejects.toMatchObject({
      messageKey: "sales.annexes.errors.notPriced",
    });

    // 13 010 000 + 1 800 000 + 650 000 DA, less 100 000 DA of discount.
    const { id: saleId } = await reserve(first, [parking, cellar], "100 000");
    const sale = await getSale(team.manager, saleId);
    expect(sale).toMatchObject({ listPrice: 1_546_000_000n, price: 1_536_000_000n });
    expect(sale?.installments.reduce((sum, i) => sum + i.amount, 0n)).toBe(1_536_000_000n);
    expect(sale?.annexes.map((a) => [a.code, a.listPrice])).toEqual([
      ["A-00-C1", 65_000_000n],
      ["A-00-P1", 180_000_000n],
    ]);
    expect(await statusOf(team.manager, [first, parking, cellar])).toEqual([
      "reserved",
      "reserved",
      "reserved",
    ]);
    expect((await getUnitSale(team.manager, parking))?.id).toBe(saleId);
    // A unit annexed to a live sale cannot go into another one.
    await expect(reserve(second, [parking])).rejects.toMatchObject({
      messageKey: "sales.annexes.errors.notAvailable",
    });

    // A swap of the main unit keeps the annexes and their prices.
    await swapUnit(
      team.manager,
      swapUnitSchema.parse({
        reservationId: saleId,
        unitId: second,
        discount: "",
        swappedOn: today,
        reason: "Étage plus bas",
      }),
    );
    expect(await getSale(team.manager, saleId)).toMatchObject({
      unitId: second,
      listPrice: 1_546_000_000n,
      price: 1_546_000_000n,
    });
    expect(await statusOf(team.manager, [first, parking])).toEqual(["available", "reserved"]);

    // The withdrawal frees the main unit and its annexes.
    const proposed = await proposeWithdrawal(
      team.manager,
      proposeWithdrawalSchema.parse({ reservationId: saleId, retention: "0", reason: "Mutation" }),
    );
    await decideWithdrawal(
      team.owner,
      decideWithdrawalSchema.parse({ withdrawalId: proposed.id, approve: true, note: "" }),
    );
    expect(await statusOf(team.manager, [second, parking, cellar])).toEqual([
      "available",
      "available",
      "available",
    ]);
    const released = await withTenant(team.manager, (tx) =>
      tx
        .select({ releasedAt: reservationAnnex.releasedAt })
        .from(reservationAnnex)
        .where(eq(reservationAnnex.reservationId, saleId)),
    );
    expect(released.every((r) => r.releasedAt !== null)).toBe(true);

    // Sold with the third flat, then handed over: the parking follows each step.
    const { id: soldId } = await reserve(third, [parking]);
    await recordSale(
      team.manager,
      recordSaleSchema.parse({
        reservationId: soldId,
        signedOn: today,
        notary: "Maître Hamidi",
        reference: "",
      }),
    );
    expect(await statusOf(team.manager, [third, parking])).toEqual(["sold", "sold"]);
    const { id: handoverId } = await scheduleHandover(
      team.manager,
      scheduleHandoverSchema.parse({
        reservationId: soldId,
        scheduledAt: `${today}T10:00`,
        notes: "",
      }),
    );
    await signHandover(
      team.manager,
      signHandoverSchema.parse({
        handoverId,
        signedOn: today,
        receivedBy: "Nadia Ouali",
        keysCount: "3",
        electricityMeter: "",
        gasMeter: "",
        waterMeter: "",
        observations: "",
      }),
    );
    expect(await statusOf(team.manager, [third, parking])).toEqual(["delivered", "delivered"]);
  });
});
