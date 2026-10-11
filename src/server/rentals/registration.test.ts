import { and, eq } from "drizzle-orm";
import readXlsxFile from "read-excel-file/node";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { registrationDuty, registrationState } from "@/lib/rentals";
import { accountingCodesSchema } from "@/server/accounting/schemas";
import { saveAccountingCodes } from "@/server/accounting/service";
import { getDashboard } from "@/server/dashboard/queries";
import { buildExport } from "@/server/exports/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getLease, listLeases } from "./queries";
import { registerLease } from "./registration";
import { createLeaseSchema, recordRentPaymentSchema, registerLeaseSchema } from "./schemas";
import { createLease, recordRentPayment } from "./service";
import { getRentalTaxes } from "./taxes";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();
const year = Number(today.slice(0, 4));

describe("lease registration and rental taxes", () => {
  it("derives the deadline and the duties", () => {
    const lease = { registeredOn: null, signedOn: "2026-03-10" };
    expect(registrationState(lease, 30, "2026-04-09")).toBe("due");
    expect(registrationState(lease, 30, "2026-04-10")).toBe("late");
    expect(registrationState({ ...lease, registeredOn: "2026-03-20" }, 30, "2026-09-01")).toBe(
      "registered",
    );
    // 2 % of 24 months at 40 000 DA.
    expect(registrationDuty({ monthlyRent: 4_000_000n, durationMonths: 24 }, 200)).toBe(1_920_000n);
    expect(registrationDuty({ monthlyRent: 4_000_000n, durationMonths: 24 }, 0)).toBe(0n);
  });

  it("follows a lease to its registration and sums the year's rents for the accountant", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const manager = await addMember(team.orgId, ["property_manager"]);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const accountant = await addMember(team.orgId, ["accountant"]);
    await saveAccountingCodes(
      accountant,
      accountingCodesSchema.parse({
        codes: {},
        tax: {
          revenueEvent: "vsp",
          vatSales: "",
          vatRentCommercial: "19",
          vatRentResidential: "",
          stampDuty: "",
          leaseRegistration: "2",
          leaseRegistrationDays: "30",
        },
        accounts: [],
      }),
    );

    // A shop leased this month, signed 40 days ago: its registration is late.
    const startOn = `${today.slice(0, 7)}-01`;
    const signedOn = addDays(today, -40);
    const { id: leaseId } = await createLease(
      manager,
      createLeaseSchema.parse({
        unitId: setup.unitIds[0],
        kind: "commercial",
        tenantName: "Pharmacie Ouali",
        tenantPhone: "0661 48 20 73",
        signedOn,
        startOn: signedOn < startOn ? startOn : signedOn,
        durationMonths: "24",
        monthlyRent: "119 000",
        frequency: "monthly",
        deposit: "",
        notes: "",
      }),
    );
    const lease = await getLease(manager, leaseId);
    expect(lease?.registration).toMatchObject({
      state: "late",
      dueOn: addDays(signedOn, 30),
      // 2 % of 24 × 119 000 DA.
      suggestedDuty: 5_712_000n,
    });
    expect((await listLeases(manager)).items[0]?.registration).toBe("late");
    const todo = await getDashboard(manager);
    expect(todo.todo.unregisteredLeases).toMatchObject([{ id: leaseId, late: true }]);

    const input = {
      leaseId,
      registeredOn: today,
      office: "Inspection de l'enregistrement de Chéraga",
      reference: "2026/1452",
      duty: "57 120",
    };
    await expect(registerLease(cashier, registerLeaseSchema.parse(input))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      registerLease(
        manager,
        registerLeaseSchema.parse({ ...input, registeredOn: addDays(signedOn, -1) }),
      ),
    ).rejects.toMatchObject({ messageKey: "rentals.registration.errors.beforeSigning" });
    await expect(
      registerLease(
        manager,
        registerLeaseSchema.parse({ ...input, registeredOn: addDays(today, 1) }),
      ),
    ).rejects.toMatchObject({ messageKey: "rentals.errors.futureDate" });
    await registerLease(manager, registerLeaseSchema.parse(input));
    // A correction keeps the trail.
    await registerLease(manager, registerLeaseSchema.parse({ ...input, reference: "2026/1453" }));
    expect(await getLease(manager, leaseId)).toMatchObject({
      registeredOn: today,
      registrationReference: "2026/1453",
      registrationDuty: 5_712_000n,
      registration: { state: "registered" },
    });
    expect((await getDashboard(manager)).todo.unregisteredLeases).toEqual([]);
    const audits = await withTenant(manager, (tx) =>
      tx
        .select({ before: auditLog.before })
        .from(auditLog)
        .where(and(eq(auditLog.action, "lease.register"), eq(auditLog.entityId, leaseId)))
        .orderBy(auditLog.createdAt),
    );
    expect(audits).toHaveLength(2);
    expect(audits[0]?.before).toBeNull();

    // The year's rental taxes: the periods due this year at 19 %, the rent collected.
    await recordRentPayment(
      cashier,
      recordRentPaymentSchema.parse({
        leaseId,
        kind: "rent",
        amount: "119 000",
        method: "cash",
        paidOn: today,
        payerName: "Pharmacie Ouali",
      }),
    );
    const taxes = await getRentalTaxes(accountant, year);
    const months = Math.min(24, 12 - Number(startOn.slice(5, 7)) + 1);
    const due = 11_900_000n * BigInt(months);
    expect(taxes.rows).toMatchObject([
      {
        id: leaseId,
        kind: "commercial",
        due,
        ht: (due * 100n) / 119n,
        vat: due - (due * 100n) / 119n,
        collected: 11_900_000n,
        duty: 5_712_000n,
      },
    ]);
    expect(taxes.totals.commercial.vat).toBe(due - (due * 100n) / 119n);
    expect(taxes.totals.residential.due).toBe(0n);
    // The next year: its twelve months due, nothing collected or registered yet.
    const next = await getRentalTaxes(accountant, year + 1);
    expect(next.rows).toMatchObject([{ due: 11_900_000n * 12n, collected: 0n, duty: 0n }]);

    // The same figures in the accountant's workbook.
    const t = (key: string) => key;
    const { file, bytes } = await buildExport(
      accountant,
      "rent_taxes",
      { year: String(year) },
      "fr",
      t,
    );
    expect(file).toBe(`fiscalite-loyers-${year}.xlsx`);
    const [sheet] = await readXlsxFile(bytes);
    expect(sheet?.data.at(-1)).toEqual([
      "exports.total",
      null,
      null,
      null,
      null,
      null,
      null,
      Number(due) / 100,
      Number((due * 100n) / 119n) / 100,
      Number(due - (due * 100n) / 119n) / 100,
      119000,
      null,
      null,
      57120,
    ]);
  });
});
