import { and, asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, handover, project, resident, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { getFileDownloadUrl } from "@/server/files/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { addResidentSchema, createResidenceSchema } from "@/server/residences/schemas";
import { addResident, createResidence } from "@/server/residences/service";
import { createReservation, recordSale } from "@/server/sales/reservations";
import { createReservationSchema, recordSaleSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import {
  handoverPvHtml,
  handoverReleaseHtml,
  loadHandoverPvData,
  loadHandoverReleaseData,
  renderAndStoreHandoverPv,
  renderAndStoreHandoverRelease,
} from "./documents";
import { getDelivery, listDeliveries, listPastDeliveryUnits } from "./queries";
import {
  addPunchItemSchema,
  cancelPunchItemSchema,
  closeReservesSchema,
  liftPunchItemSchema,
  pastDeliveriesSchema,
  scheduleHandoverSchema,
  signHandoverSchema,
  updatePunchItemSchema,
} from "./schemas";
import {
  addPunchItem,
  cancelPunchItem,
  closeReserves,
  deletePunchItem,
  liftPunchItem,
  recordPastDeliveries,
  scheduleHandover,
  signHandover,
  updatePunchItem,
} from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();
const year = today.slice(0, 4);

const company = {
  name: "Promo",
  legalName: "SARL Promo",
  address: null,
  wilaya: null,
  phone: null,
  rcNumber: null,
  nif: null,
  nis: null,
  aiNumber: null,
  logo: null,
};

/** A team with a responsable technique and a cashier; a commercial's buyer reserves a unit. */
async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const technical = await addMember(team.orgId, ["technical_manager"]);
  const cashier = await addMember(team.orgId, ["cashier"]);
  const leadId = await newLead(team.agentA);
  const buyerId = (
    await createBuyer(
      team.agentA,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        lastNameAr: "بن سالم",
        firstNameAr: "كريم",
        phone: "0550 12 34 56",
        leadId,
      }),
    )
  ).id;
  return { team, setup, technical, cashier, buyerId };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;

/** Reserves a unit 60 days ago, pays the signing share and signs the VSP 30 days ago. */
async function soldSale({ team, setup, cashier, buyerId }: Scenario, unitIndex: 0 | 1 | 2 = 0) {
  const { id } = await createReservation(
    team.agentA,
    createReservationSchema.parse({
      unitId: setup.unitIds[unitIndex],
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
      reservationId: id,
      amount: "2 602 000",
      method: "cash",
      paidOn: addDays(today, -60),
      payerName: "Karim Bensalem",
    }),
  );
  await recordSale(
    team.manager,
    recordSaleSchema.parse({
      reservationId: id,
      signedOn: addDays(today, -30),
      notary: "Maître Hamidi",
      reference: "Rép. 2026/77",
    }),
  );
  return id;
}

const schedule = (ctx: TenantCtx, reservationId: string, at = `${addDays(today, 3)}T10:00`) =>
  scheduleHandover(
    ctx,
    scheduleHandoverSchema.parse({ reservationId, scheduledAt: at, notes: "Prévoir la CNI" }),
  );

const reserveInput = (handoverId: string, location: string, description: string) =>
  addPunchItemSchema.parse({ handoverId, location, description, trade: "plumbing", dueOn: "" });

const signInput = (handoverId: string, overrides: Record<string, string> = {}) =>
  signHandoverSchema.parse({
    handoverId,
    signedOn: today,
    receivedBy: "Karim Bensalem",
    keysCount: "3",
    electricityMeter: "004512",
    gasMeter: "",
    waterMeter: "1187",
    observations: "",
    ...overrides,
  });

const unitStatusOf = async (ctx: TenantCtx, unitId: string) =>
  (
    await withTenant(ctx, (tx) =>
      tx.select({ s: unit.status }).from(unit).where(eq(unit.id, unitId)),
    )
  )[0]?.s;

describe("deliveries", () => {
  it("plans the handover, lists the reserves, signs the PV and closes the reserves", async () => {
    const s = await scenario();
    const { team, setup, technical, cashier } = s;
    const saleId = await soldSale(s);

    await expect(schedule(team.agentA, saleId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { id: handoverId } = await schedule(technical, saleId);
    // Moving the appointment keeps the same handover.
    expect(await schedule(technical, saleId, `${addDays(today, 4)}T09:30`)).toEqual({
      id: handoverId,
    });
    let deliveries = await listDeliveries(technical);
    expect(deliveries.items.map((d) => [d.unitCode, d.state, d.buyers])).toEqual([
      ["A-03-01", "scheduled", "Bensalem Karim"],
    ]);
    expect(deliveries.items[0]?.remaining).toBe(1_040_800_000n);

    // Reserves found at the visit: numbered, the next ones move up when one is deleted.
    const tap = await addPunchItem(
      technical,
      reserveInput(handoverId, "Cuisine", "Robinet qui fuit"),
    );
    const tile = await addPunchItem(
      technical,
      reserveInput(handoverId, "Séjour", "Carreau fissuré"),
    );
    const door = await addPunchItem(
      technical,
      reserveInput(handoverId, "Chambre 1", "Porte qui frotte"),
    );
    await deletePunchItem(technical, tile.id);
    await updatePunchItem(
      technical,
      updatePunchItemSchema.parse({
        punchItemId: door.id,
        location: "Chambre 1",
        description: "Porte qui frotte au sol",
        trade: "joinery",
        dueOn: addDays(today, 15),
      }),
    );
    // Fixed before the keys are handed over: not printed on the PV.
    await liftPunchItem(
      technical,
      liftPunchItemSchema.parse({ punchItemId: tap.id, liftedOn: today, note: "Joint changé" }),
    );
    const delivery = await getDelivery(technical, saleId);
    expect(delivery?.items.map((i) => [i.position, i.location, i.status])).toEqual([
      [1, "Cuisine", "lifted"],
      [2, "Chambre 1", "open"],
    ]);

    await expect(
      signHandover(technical, signInput(handoverId, { signedOn: addDays(today, -31) })),
    ).rejects.toMatchObject({ messageKey: "handovers.errors.beforeSale" });
    await expect(
      signHandover(technical, signInput(handoverId, { signedOn: addDays(today, 1) })),
    ).rejects.toMatchObject({ messageKey: "handovers.errors.futureDate" });
    await expect(signHandover(cashier, signInput(handoverId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const signed = await signHandover(technical, signInput(handoverId));
    expect(signed).toEqual({
      number: `PVL-${year}-000001`,
      outstanding: 1_040_800_000n,
      reserves: 1,
      coOwners: 0,
    });
    expect(await unitStatusOf(technical, setup.unitIds[0])).toBe("delivered");
    await expect(signHandover(technical, signInput(handoverId))).rejects.toMatchObject({
      messageKey: "handovers.errors.signed",
    });
    await expect(schedule(technical, saleId)).rejects.toMatchObject({
      messageKey: "handovers.errors.signed",
    });

    // The reserve printed on the PV no longer changes; one found later still can.
    await expect(deletePunchItem(technical, door.id)).rejects.toMatchObject({
      messageKey: "handovers.errors.onPv",
    });
    const later = await addPunchItem(
      technical,
      reserveInput(handoverId, "Balcon", "Garde-corps mal fixé"),
    );
    await expect(
      closeReserves(technical, closeReservesSchema.parse({ handoverId, closedOn: today })),
    ).rejects.toMatchObject({ messageKey: "handovers.errors.openReserves" });
    await liftPunchItem(
      technical,
      liftPunchItemSchema.parse({ punchItemId: door.id, liftedOn: today, note: "" }),
    );
    await expect(
      liftPunchItem(
        technical,
        liftPunchItemSchema.parse({ punchItemId: door.id, liftedOn: today, note: "" }),
      ),
    ).rejects.toMatchObject({ messageKey: "handovers.errors.reserveSettled" });
    await cancelPunchItem(
      technical,
      cancelPunchItemSchema.parse({ punchItemId: later.id, reason: "Déjà repris avant la visite" }),
    );
    deliveries = await listDeliveries(technical);
    expect(deliveries.items[0]?.state).toBe("reserves");
    await expect(
      closeReserves(
        technical,
        closeReservesSchema.parse({ handoverId, closedOn: addDays(today, -1) }),
      ),
    ).rejects.toMatchObject({ messageKey: "handovers.errors.beforeLifting" });
    await closeReserves(technical, closeReservesSchema.parse({ handoverId, closedOn: today }));
    await expect(
      addPunchItem(technical, reserveInput(handoverId, "Cave", "Serrure")),
    ).rejects.toMatchObject({ messageKey: "handovers.errors.reservesClosed" });
    expect((await listDeliveries(technical)).items).toEqual([]);
    deliveries = await listDeliveries(technical, { state: "delivered" });
    expect(deliveries.items.map((d) => d.unitCode)).toEqual(["A-03-01"]);
    expect(deliveries.counts).toMatchObject({ delivered: 1, scheduled: 0 });

    const audit = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "handover"), eq(auditLog.entityId, handoverId)))
        .orderBy(asc(auditLog.createdAt)),
    );
    expect(audit.map((a) => a.action)).toEqual(["handover.sign", "handover.close_reserves"]);

    // Both PVs, bilingual, rendered once and filed under the handover.
    const pv = await withTenant(team.owner, (tx) => loadHandoverPvData(tx, handoverId));
    if (!pv) throw new Error("PV data missing");
    const pvHtml = handoverPvHtml(pv.data, company);
    expect(pvHtml).toContain("PROCÈS-VERBAL DE REMISE DES CLÉS");
    expect(pvHtml).toContain("محضر تسليم المفاتيح");
    expect(pvHtml).toContain("Porte qui frotte au sol");
    expect(pvHtml).not.toContain("Robinet qui fuit");
    expect(pvHtml).toContain("Reste à payer");
    const release = await withTenant(team.owner, (tx) => loadHandoverReleaseData(tx, handoverId));
    if (!release) throw new Error("release data missing");
    const releaseHtml = handoverReleaseHtml(release.data, company);
    expect(releaseHtml).toContain("محضر رفع التحفظات");
    expect(releaseHtml).toContain("Déjà repris avant la visite");
    expect(await renderAndStoreHandoverPv(team.orgId, handoverId)).toBe("stored");
    expect(await renderAndStoreHandoverPv(team.orgId, handoverId)).toBe("skipped");
    expect(await renderAndStoreHandoverRelease(team.orgId, handoverId)).toBe("stored");
    const [files] = await withTenant(team.owner, (tx) =>
      tx
        .select({ pdf: handover.pdfFileId, release: handover.releaseFileId })
        .from(handover)
        .where(eq(handover.id, handoverId)),
    );
    // The deliveries team and whoever sees the sale read them; another commercial does not.
    expect(await getFileDownloadUrl(technical, files?.pdf ?? "", "inline")).toMatch(/^http/);
    expect(await getFileDownloadUrl(team.agentA, files?.release ?? "", "inline")).toMatch(/^http/);
    await expect(getFileDownloadUrl(team.agentB, files?.pdf ?? "", "inline")).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
  }, 60_000);

  it("refuses unsold units and lists the ready ones to schedule", async () => {
    const s = await scenario();
    const { team, setup, technical } = s;
    const { id: reserved } = await createReservation(
      team.agentA,
      createReservationSchema.parse({
        unitId: setup.unitIds[1],
        buyerIds: [s.buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: today,
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    await expect(schedule(technical, reserved)).rejects.toMatchObject({
      messageKey: "handovers.errors.notSold",
    });
    expect(await getDelivery(technical, reserved)).toBeNull();

    await soldSale(s, 0);
    // The works are not finished: nothing to schedule yet.
    expect((await listDeliveries(technical)).items).toEqual([]);
    expect((await listDeliveries(technical, { state: "all" })).items[0]?.state).toBe("not_ready");
    await withTenant(team.owner, (tx) =>
      tx.update(project).set({ status: "delivered" }).where(eq(project.id, setup.projectId)),
    );
    expect((await listDeliveries(technical)).items.map((d) => d.state)).toEqual(["to_schedule"]);
    // Another organization sees none of it.
    const other = await scenario();
    expect((await listDeliveries(other.technical, { state: "all" })).items).toEqual([]);
  });

  it("makes the buyers co-owners of a residence unit and records deliveries before the app", async () => {
    const s = await scenario();
    const { team, setup, technical } = s;
    const manager = await addMember(team.orgId, ["property_manager"]);
    const { id: residenceId } = await createResidence(
      manager,
      createResidenceSchema.parse({
        projectId: setup.projectId,
        name: "Résidence Les Oliviers",
        shareBasis: "10000",
        chargeFrequency: "quarterly",
        reserveFund: "0",
        callDueDays: "30",
      }),
    );
    const saleId = await soldSale(s, 0);
    const { id: handoverId } = await schedule(technical, saleId);
    expect(
      await signHandover(technical, signInput(handoverId, { signedOn: addDays(today, -1) })),
    ).toMatchObject({ reserves: 0, coOwners: 1 });
    const owners = await withTenant(team.owner, (tx) =>
      tx
        .select({
          lastName: resident.lastName,
          isMain: resident.isMain,
          sinceOn: resident.sinceOn,
          residenceId: resident.residenceId,
        })
        .from(resident)
        .where(eq(resident.unitId, setup.unitIds[0])),
    );
    expect(owners).toEqual([
      { lastName: "Bensalem", isMain: true, sinceOn: addDays(today, -1), residenceId },
    ]);

    // A unit already given its co-owner by hand keeps it.
    await addResident(
      manager,
      addResidentSchema.parse({
        residenceId,
        unitId: setup.unitIds[1],
        kind: "co_owner",
        isMain: true,
        lastName: "Amrani",
        firstName: "Souad",
        sinceOn: "2026-01-01",
      }),
    );
    const second = await soldSale(s, 1);
    const { id: secondHandover } = await schedule(technical, second);
    expect(await signHandover(technical, signInput(secondHandover))).toMatchObject({
      coOwners: 0,
    });

    // Deliveries before the app: only in a delivered project, only units never sold here.
    const input = pastDeliveriesSchema.parse({
      projectId: setup.projectId,
      unitIds: [setup.unitIds[2]],
      reason: "Vendu et livré avant l'application",
    });
    await expect(recordPastDeliveries(team.agentA, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(recordPastDeliveries(technical, input)).rejects.toMatchObject({
      messageKey: "handovers.errors.projectNotDelivered",
    });
    await withTenant(team.owner, (tx) =>
      tx.update(project).set({ status: "delivered" }).where(eq(project.id, setup.projectId)),
    );
    expect((await listPastDeliveryUnits(technical, setup.projectId)).map((u) => u.code)).toEqual([
      "A-04-01",
    ]);
    await expect(
      recordPastDeliveries(
        technical,
        pastDeliveriesSchema.parse({ ...input, unitIds: [setup.unitIds[0], setup.unitIds[2]] }),
      ),
    ).rejects.toMatchObject({ messageKey: "handovers.errors.unitEngaged" });
    expect(await recordPastDeliveries(technical, input)).toEqual({ delivered: 1 });
    expect(await unitStatusOf(technical, setup.unitIds[2])).toBe("delivered");
    expect(await listPastDeliveryUnits(technical, setup.projectId)).toEqual([]);
  });
});
