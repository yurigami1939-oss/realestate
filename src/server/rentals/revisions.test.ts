import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, lease, rentPayment } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, addMonths, todayInAlgiers } from "@/lib/dates";
import { buildRentPeriods, rentOn } from "@/lib/rentals";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getLease, listLeases } from "./queries";
import {
  createLeaseSchema,
  recordRentPaymentSchema,
  renewLeaseSchema,
  reviseRentSchema,
} from "./schemas";
import { createLease, recordRentPayment, renewLease, reviseRent } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("rent revisions", () => {
  it("dues each period at the amounts in force on its first day", () => {
    const periods = buildRentPeriods({
      startOn: "2026-01-01",
      durationMonths: 12,
      frequency: "quarterly",
      monthlyRent: 4_000_000n,
      monthlyCharges: 500_000n,
      revisions: [{ effectiveOn: "2026-07-01", monthlyRent: 4_120_000n, monthlyCharges: 0n }],
    });
    expect(periods.map((p) => [p.fromOn, p.amount])).toEqual([
      ["2026-01-01", 13_500_000n],
      ["2026-04-01", 13_500_000n],
      ["2026-07-01", 12_360_000n],
      ["2026-10-01", 12_360_000n],
    ]);
    const terms = { monthlyRent: 4_000_000n, monthlyCharges: 0n, revisions: [] };
    expect(rentOn(terms, "2026-06-30")).toEqual({ monthlyRent: 4_000_000n, monthlyCharges: 0n });
  });

  it("revises a lease's rent from a period on, with a guarantor kept on its renewal", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const manager = await addMember(team.orgId, ["property_manager"]);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const startOn = addMonths(today, -3);
    const { id: leaseId } = await createLease(
      manager,
      createLeaseSchema.parse({
        unitId: setup.unitIds[0],
        kind: "residential",
        tenantName: "Hamidi Yasmine",
        tenantPhone: "0661 48 20 73",
        guarantorName: "Hamidi Rachid",
        guarantorIdNumber: "109870123456789012",
        guarantorPhone: "0550 12 98 76",
        guarantorAddress: "Cité 1200 logements, Bab Ezzouar",
        signedOn: addDays(startOn, -5),
        startOn,
        durationMonths: "12",
        monthlyRent: "40 000",
        frequency: "monthly",
        deposit: "",
        notes: "",
      }),
    );
    const pay = (amount: string) =>
      recordRentPayment(
        cashier,
        recordRentPaymentSchema.parse({
          leaseId,
          kind: "rent",
          amount,
          method: "cash",
          paidOn: today,
          payerName: "Hamidi Yasmine",
        }),
      );
    await pay("120 000");

    const revision = (effectiveOn: string, monthlyRent = "41 200") =>
      reviseRentSchema.parse({
        leaseId,
        effectiveOn,
        monthlyRent,
        monthlyCharges: "",
        reason: "Indexation annuelle 3 %",
      });
    const fourth = addMonths(startOn, 3);
    await expect(reviseRent(cashier, revision(fourth))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // The first period, or a day that starts no period, is refused.
    await expect(reviseRent(manager, revision(startOn))).rejects.toMatchObject({
      messageKey: "rentals.errors.revisionPeriod",
    });
    await expect(reviseRent(manager, revision(addDays(fourth, 3)))).rejects.toMatchObject({
      messageKey: "rentals.errors.revisionPeriod",
    });
    await reviseRent(manager, revision(fourth));
    await expect(
      reviseRent(manager, revision(addMonths(startOn, 2), "42 000")),
    ).rejects.toMatchObject({ messageKey: "rentals.errors.revisionOrder" });

    const detail = await getLease(manager, leaseId);
    expect(detail?.statement.lines.slice(0, 5).map((l) => l.amount)).toEqual([
      4_000_000n,
      4_000_000n,
      4_000_000n,
      4_120_000n,
      4_120_000n,
    ]);
    expect(detail?.inForce).toEqual({ monthlyRent: 4_120_000n, monthlyCharges: 0n });
    expect(detail?.revisions).toMatchObject([
      { effectiveOn: fourth, monthlyRent: 4_120_000n, reason: "Indexation annuelle 3 %" },
    ]);
    expect(detail?.guarantorName).toBe("Hamidi Rachid");
    const listed = (await listLeases(manager)).items.find((l) => l.id === leaseId);
    expect(listed?.monthlyRent).toBe(4_120_000n);

    // The next payment settles the revised period in full.
    const { paymentId } = await pay("41 200");
    const [paid] = await withTenant(manager, (tx) =>
      tx
        .select({ allocation: rentPayment.allocation })
        .from(rentPayment)
        .where(eq(rentPayment.id, paymentId)),
    );
    expect(paid?.allocation).toEqual([
      { fromOn: fourth, toOn: addDays(addMonths(startOn, 4), -1), amount: "4120000" },
    ]);

    const { id: renewalId } = await renewLease(
      manager,
      renewLeaseSchema.parse({
        leaseId,
        signedOn: today,
        durationMonths: "12",
        monthlyRent: "41 200",
        monthlyCharges: "",
        frequency: "monthly",
        deposit: "",
        notes: "",
      }),
    );
    const [renewal] = await withTenant(manager, (tx) =>
      tx
        .select({ guarantorName: lease.guarantorName, monthlyRent: lease.monthlyRent })
        .from(lease)
        .where(eq(lease.id, renewalId)),
    );
    expect(renewal).toEqual({ guarantorName: "Hamidi Rachid", monthlyRent: 4_120_000n });
    const audits = await withTenant(manager, (tx) =>
      tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(and(eq(auditLog.action, "lease.revise"), eq(auditLog.entityId, leaseId))),
    );
    expect(audits).toHaveLength(1);
  });
});
