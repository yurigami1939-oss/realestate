import { and, asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, rentPayment, resident, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, addMonths, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { getFileDownloadUrl } from "@/server/files/service";
import { unitStatusReasonSchema } from "@/server/inventory/schemas";
import { blockUnit } from "@/server/inventory/service";
import { createResidenceSchema } from "@/server/residences/schemas";
import { createResidence } from "@/server/residences/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { sendRentsDigest } from "./digest";
import {
  inspectionHtml,
  loadInspectionData,
  loadRentReceiptData,
  renderAndStoreInspection,
  renderAndStoreRentReceipt,
} from "./documents";
import { getLease, getUnitLease, listLeasableUnits, listLeases, listOverdueRents } from "./queries";
import {
  cancelRentPaymentSchema,
  createLeaseSchema,
  endLeaseSchema,
  recordInspectionSchema,
  recordRentPaymentSchema,
  renewLeaseSchema,
  settleDepositSchema,
  updateLeaseSchema,
} from "./schemas";
import {
  cancelRentPayment,
  createLease,
  endLease,
  recordInspection,
  recordRentPayment,
  renewLease,
  settleDeposit,
  updateLease,
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

async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const [manager, cashier, accountant] = [
    await addMember(team.orgId, ["property_manager"]),
    await addMember(team.orgId, ["cashier"]),
    await addMember(team.orgId, ["accountant"]),
  ];
  return { team, setup, manager, cashier, accountant };
}

/** Raw form values of a lease (strings, as the form sends them). */
const rawLease = (unitId: string, overrides: Record<string, unknown> = {}) => ({
  unitId,
  kind: "commercial",
  tenantName: "SARL Pharmacie El Amel",
  tenantNameAr: "",
  tenantIdNumber: "16/00-4471203B21",
  tenantPhone: "0550 44 21 07",
  tenantEmail: "",
  tenantAddress: "",
  activity: "Pharmacie",
  signedOn: addDays(today, -65),
  startOn: addDays(today, -60),
  durationMonths: "12",
  monthlyRent: "45 000",
  monthlyCharges: "5 000",
  frequency: "quarterly",
  deposit: "90 000",
  notes: "",
  ...overrides,
});

const leaseInput = (unitId: string, overrides: Record<string, unknown> = {}) =>
  createLeaseSchema.parse(rawLease(unitId, overrides));

const pay = (ctx: TenantCtx, leaseId: string, kind: "rent" | "deposit", amount: string) =>
  recordRentPayment(
    ctx,
    recordRentPaymentSchema.parse({
      leaseId,
      kind,
      amount,
      method: "bank_transfer",
      paidOn: today,
      reference: "VIR-118",
      bank: "",
      payerName: "SARL Pharmacie El Amel",
      notes: "",
    }),
  );

const statusOf = async (ctx: TenantCtx, unitId: string) =>
  (
    await withTenant(ctx, (tx) =>
      tx.select({ s: unit.status }).from(unit).where(eq(unit.id, unitId)),
    )
  )[0]?.s;

describe("rentals", () => {
  it("leases a unit, collects rent and deposit against receipts, then ends the lease", async () => {
    const { team, setup, manager, cashier, accountant } = await scenario();
    const unitId = setup.unitIds[0];

    await expect(createLease(team.agentA, leaseInput(unitId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { id, number } = await createLease(manager, leaseInput(unitId));
    expect(number).toBe(`BAL-${year}-000001`);
    expect(await statusOf(manager, unitId)).toBe("rented");
    await expect(createLease(manager, leaseInput(unitId))).rejects.toMatchObject({
      messageKey: "rentals.errors.unitNotFree",
    });
    expect((await listLeasableUnits(manager)).map((u) => u.code)).toEqual(["A-03-02", "A-04-01"]);

    // Four quarters of 150 000 DA paid in advance; the first one is overdue.
    let detail = await getLease(cashier, id);
    expect(detail?.endOn).toBe(addDays(addMonths(addDays(today, -60), 12), -1));
    expect(detail?.statement.lines.map((l) => [l.fromOn, l.amount, l.state])).toEqual([
      [addDays(today, -60), 150_000_00n, "overdue"],
      [addMonths(addDays(today, -60), 3), 150_000_00n, "upcoming"],
      [addMonths(addDays(today, -60), 6), 150_000_00n, "upcoming"],
      [addMonths(addDays(today, -60), 9), 150_000_00n, "upcoming"],
    ]);
    expect(detail?.state).toBe("running");

    await expect(pay(team.agentA, id, "rent", "1 000")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const quittance = await pay(cashier, id, "rent", "150 000");
    expect(quittance.receiptNumber).toBe(`QIT-${year}-000001`);
    await expect(pay(cashier, id, "rent", "450 001")).rejects.toMatchObject({
      messageKey: "rentals.errors.aboveRemaining",
    });
    await pay(cashier, id, "deposit", "90 000");
    await expect(pay(cashier, id, "deposit", "1")).rejects.toMatchObject({
      messageKey: "rentals.errors.aboveDeposit",
    });
    detail = await getLease(cashier, id);
    expect(detail?.statement.overdue).toBe(0n);
    expect(detail?.depositHeld).toBe(90_000_00n);
    expect(detail?.payments.find((p) => p.kind === "rent")?.allocation).toEqual([
      {
        fromOn: addDays(today, -60),
        toOn: addDays(addMonths(addDays(today, -60), 3), -1),
        amount: "15000000",
      },
    ]);

    // Paid leases keep their terms; the tenant's details still change.
    const update = (overrides: Record<string, unknown>) =>
      updateLease(
        manager,
        updateLeaseSchema.parse({ ...rawLease(unitId, overrides), leaseId: id }),
      );
    await expect(update({ monthlyRent: "50 000" })).rejects.toMatchObject({
      messageKey: "rentals.errors.termsLocked",
    });
    await update({ tenantPhone: "0661 10 20 30" });

    // A bounced transfer: the quarter is overdue again.
    await expect(
      cancelRentPayment(
        cashier,
        cancelRentPaymentSchema.parse({ paymentId: quittance.paymentId, reason: "Rejet" }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await cancelRentPayment(
      accountant,
      cancelRentPaymentSchema.parse({ paymentId: quittance.paymentId, reason: "Virement rejeté" }),
    );
    expect((await getLease(cashier, id))?.statement.overdue).toBe(150_000_00n);

    // The tenant leaves today: only the quarter already started stays due.
    await endLease(
      manager,
      endLeaseSchema.parse({ leaseId: id, endedOn: today, reason: "Départ du locataire" }),
    );
    expect(await statusOf(manager, unitId)).toBe("available");
    detail = await getLease(cashier, id);
    expect(detail?.statement.lines).toHaveLength(1);
    expect(detail?.state).toBe("ended");
    await expect(
      endLease(manager, endLeaseSchema.parse({ leaseId: id, endedOn: today, reason: "x" })),
    ).rejects.toMatchObject({ messageKey: "rentals.errors.ended" });

    // Part of the deposit is kept for the repairs.
    const settle = (refunded: string, reason = "") =>
      settleDeposit(
        manager,
        settleDepositSchema.parse({ leaseId: id, settledOn: today, refunded, reason }),
      );
    await expect(settle("100 000")).rejects.toMatchObject({
      messageKey: "rentals.errors.aboveHeld",
    });
    await expect(settle("60 000")).rejects.toMatchObject({
      messageKey: "rentals.errors.retentionReason",
    });
    await settle("60 000", "Reprise des peintures");
    expect(await getLease(cashier, id)).toMatchObject({
      depositRefunded: 60_000_00n,
      depositRetained: 30_000_00n,
    });
    await expect(settle("90 000")).rejects.toMatchObject({
      messageKey: "rentals.errors.depositSettled",
    });

    const audit = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "lease"), eq(auditLog.entityId, id)))
        .orderBy(asc(auditLog.createdAt)),
    );
    expect(audit.map((a) => a.action)).toEqual([
      "lease.create",
      "rent_payment.create",
      "rent_payment.create",
      "lease.update",
      "rent_payment.cancel",
      "lease.end",
      "lease.settle_deposit",
    ]);

    // The quittance, filed under its lease, for whoever reads leases.
    const [payment] = await withTenant(cashier, (tx) =>
      tx
        .select({ id: rentPayment.id })
        .from(rentPayment)
        .where(and(eq(rentPayment.leaseId, id), eq(rentPayment.kind, "deposit"))),
    );
    const receipt = await withTenant(cashier, (tx) =>
      loadRentReceiptData(tx, team.orgId, payment?.id ?? ""),
    );
    expect(receipt?.data.title).toEqual({
      fr: "REÇU DE DÉPÔT DE GARANTIE",
      ar: "وصل استلام مبلغ الضمان",
    });
    expect(await renderAndStoreRentReceipt(team.orgId, payment?.id ?? "")).toBe("stored");
    const stored = await getLease(cashier, id);
    const fileId = stored?.payments.find((p) => p.kind === "deposit")?.pdfFileId ?? "";
    expect(await getFileDownloadUrl(cashier, fileId, "inline")).toMatch(/^http/);
    await expect(getFileDownloadUrl(team.agentA, fileId, "inline")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Another organization sees nothing of it.
    const other = await scenario();
    expect(await getLease(other.cashier, id)).toBeNull();
  }, 60_000);

  it("leases a kept unit of a residence: the tenant occupies it; a renewal carries the deposit", async () => {
    const { team, setup, manager, cashier } = await scenario();
    const unitId = setup.unitIds[1];
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
    await blockUnit(
      team.owner,
      unitStatusReasonSchema.parse({ unitId, reason: "Local conservé par la société" }),
    );
    const { id } = await createLease(
      manager,
      leaseInput(unitId, {
        kind: "residential",
        tenantName: "Bouzid Hamid",
        frequency: "yearly",
        startOn: addDays(today, -320),
        signedOn: addDays(today, -320),
      }),
    );
    expect(await statusOf(manager, unitId)).toBe("rented");
    const occupants = () =>
      withTenant(manager, (tx) =>
        tx
          .select({
            lastName: resident.lastName,
            kind: resident.kind,
            sinceOn: resident.sinceOn,
            untilOn: resident.untilOn,
            residenceId: resident.residenceId,
          })
          .from(resident)
          .where(eq(resident.unitId, unitId)),
      );
    expect(await occupants()).toEqual([
      {
        lastName: "Bouzid Hamid",
        kind: "occupant",
        sinceOn: addDays(today, -320),
        untilOn: null,
        residenceId,
      },
    ]);
    await pay(cashier, id, "deposit", "90 000");
    expect((await listLeases(manager)).items[0]?.state).toBe("ending");

    const { id: renewalId, number } = await renewLease(
      manager,
      renewLeaseSchema.parse({
        leaseId: id,
        signedOn: today,
        durationMonths: "12",
        monthlyRent: "48 000",
        monthlyCharges: "5 000",
        frequency: "yearly",
        deposit: "96 000",
        notes: "",
      }),
    );
    const previous = await getLease(manager, id);
    const renewal = await getLease(manager, renewalId);
    expect(previous).toMatchObject({
      status: "ended",
      endReason: number,
      renewal: { id: renewalId },
    });
    expect(renewal).toMatchObject({
      startOn: addDays(previous?.endOn ?? "", 1),
      depositCarried: 90_000_00n,
      depositHeld: 90_000_00n,
      renewedFrom: { id },
    });
    expect(await statusOf(manager, unitId)).toBe("rented");
    // The deposit moved to the renewal: only 6 000 DA are still missing on it.
    await expect(pay(cashier, renewalId, "deposit", "6 001")).rejects.toMatchObject({
      messageKey: "rentals.errors.aboveDeposit",
    });
    await expect(
      settleDeposit(
        manager,
        settleDepositSchema.parse({ leaseId: id, settledOn: today, refunded: "", reason: "" }),
      ),
    ).rejects.toMatchObject({ messageKey: "rentals.errors.depositCarried" });

    await endLease(
      manager,
      endLeaseSchema.parse({ leaseId: renewalId, endedOn: today, reason: "Fin d'occupation" }),
    );
    expect((await occupants())[0]?.untilOn).toBe(today);
    expect(await statusOf(manager, unitId)).toBe("available");
  });

  it("records the états des lieux, lists the overdue rents and e-mails the rentals digest", async () => {
    const { team, setup, manager, cashier } = await scenario();
    const unitId = setup.unitIds[2];
    const { id } = await createLease(
      manager,
      leaseInput(unitId, {
        signedOn: addDays(today, -40),
        startOn: addDays(today, -40),
        durationMonths: "2",
        frequency: "monthly",
      }),
    );
    // Two months of 50 000 DA, both started and unpaid; the term ends within 30 days.
    expect(await listOverdueRents(cashier)).toMatchObject([
      { id, overdue: 100_000_00n, oldestDueOn: addDays(today, -40), daysLate: 40 },
    ]);
    expect(await getUnitLease(manager, unitId)).toMatchObject({
      id,
      tenantName: "SARL Pharmacie El Amel",
    });

    const inspect = (kind: "check_in" | "check_out", overrides: Record<string, unknown> = {}) =>
      recordInspection(
        manager,
        recordInspectionSchema.parse({
          leaseId: id,
          kind,
          inspectedOn: addDays(today, -40),
          items: [
            { element: "Salle", condition: "good", notes: "" },
            { element: "Vitrine", condition: "fair", notes: "Joint usé" },
          ],
          electricityMeter: "001245",
          gasMeter: "",
          waterMeter: "",
          keysCount: "2",
          observations: "",
          ...overrides,
        }),
      );
    await expect(
      recordInspection(
        cashier,
        recordInspectionSchema.parse({
          leaseId: id,
          kind: "check_in",
          inspectedOn: today,
          items: [{ element: "Salle", condition: "good", notes: "" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await inspect("check_in");
    await expect(inspect("check_in")).rejects.toMatchObject({
      messageKey: "rentals.errors.inspectionRecorded",
    });
    await inspect("check_out", {
      inspectedOn: today,
      items: [
        { element: "Salle", condition: "fair", notes: "Tache au mur" },
        { element: "Vitrine", condition: "fair", notes: "" },
      ],
    });
    const lease = await getLease(manager, id);
    const exit = lease?.inspections.find((i) => i.kind === "check_out");
    const report = await withTenant(manager, (tx) => loadInspectionData(tx, exit?.id ?? ""));
    if (!report) throw new Error("inspection report missing");
    // The exit report shows each element's condition at the entry.
    expect(report.data.entry).toEqual({ Salle: "good", Vitrine: "fair" });
    const html = inspectionHtml(report.data, company);
    expect(html).toContain("ÉTAT DES LIEUX DE SORTIE");
    expect(html).toContain("محضر معاينة الخروج");
    expect(html).toContain("Tache au mur");
    expect(await renderAndStoreInspection(team.orgId, exit?.id ?? "")).toBe("stored");

    // The property manager and the cashier get the daily rentals digest.
    expect(await sendRentsDigest(team.orgId, today)).toBe(2);
  }, 60_000);
});
