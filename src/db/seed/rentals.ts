/**
 * Demo rentals (module 5): the shop the company kept at El Yasmine leased to a pharmacy (rent
 * paid quarterly in advance, the current quarter overdue), a flat of Les Amandiers rented to a
 * family (rent paid to date, term ending within two months) and another one left last spring
 * (exit inspection, part of the deposit kept); the pharmacy's charges of last year are settled
 * (a balance due). Dated relative to today (Algiers); the PDFs render when `pnpm worker` runs.
 */
import { and, eq } from "drizzle-orm";

import { project, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, addMonths, todayInAlgiers } from "@/lib/dates";
import { type Centimes, toDecimalString } from "@/lib/money";
import type { TenantCtx } from "@/server/auth/session";
import { getLease } from "@/server/rentals/queries";
import {
  createLeaseSchema,
  endLeaseSchema,
  recordInspectionSchema,
  recordRentPaymentSchema,
  reviseRentSchema,
  settleDepositSchema,
  settleLeaseChargesSchema,
} from "@/server/rentals/schemas";
import {
  createLease,
  endLease,
  recordInspection,
  recordRentPayment,
  reviseRent,
  settleDeposit,
} from "@/server/rentals/service";
import { settleLeaseCharges } from "@/server/rentals/settlements";

type Actors = { manager: TenantCtx; cashier: TenantCtx };

const asInput = (amount: Centimes) => toDecimalString(amount).replace(".", ",");

async function unitOf(ctx: TenantCtx, projectCode: string, unitCode: string) {
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ id: unit.id })
      .from(unit)
      .innerJoin(project, eq(project.id, unit.projectId))
      .where(and(eq(project.code, projectCode), eq(unit.code, unitCode))),
  );
  if (!row) throw new Error(`seed: unit ${projectCode} ${unitCode} missing`);
  return row.id;
}

type LeaseSpec = {
  project: string;
  unit: string;
  kind: "residential" | "commercial";
  tenantName: string;
  tenantNameAr: string;
  tenantIdNumber?: string;
  tenantPhone: string;
  tenantEmail?: string;
  activity?: string;
  startDaysAgo: number;
  durationMonths: number;
  monthlyRent: string;
  monthlyCharges?: string;
  frequency: "monthly" | "quarterly" | "half_yearly" | "yearly";
  deposit: string;
  /** The tenant agreed to WhatsApp notifications. */
  whatsapp?: boolean;
  guarantor?: { name: string; idNumber: string; phone: string };
};

async function lease({ manager }: Actors, spec: LeaseSpec) {
  const today = todayInAlgiers();
  const { id } = await createLease(
    manager,
    createLeaseSchema.parse({
      unitId: await unitOf(manager, spec.project, spec.unit),
      kind: spec.kind,
      tenantName: spec.tenantName,
      tenantNameAr: spec.tenantNameAr,
      tenantIdNumber: spec.tenantIdNumber ?? "",
      tenantPhone: spec.tenantPhone,
      tenantWhatsappOptIn: spec.whatsapp ?? false,
      tenantEmail: spec.tenantEmail ?? "",
      tenantAddress: "",
      activity: spec.activity ?? "",
      guarantorName: spec.guarantor?.name ?? "",
      guarantorIdNumber: spec.guarantor?.idNumber ?? "",
      guarantorPhone: spec.guarantor?.phone ?? "",
      guarantorAddress: "",
      signedOn: addDays(today, -spec.startDaysAgo - 7),
      startOn: addDays(today, -spec.startDaysAgo),
      durationMonths: String(spec.durationMonths),
      monthlyRent: spec.monthlyRent,
      monthlyCharges: spec.monthlyCharges ?? "",
      frequency: spec.frequency,
      deposit: spec.deposit,
      notes: "",
    }),
  );
  return id;
}

async function pay(
  { cashier }: Actors,
  leaseId: string,
  kind: "rent" | "deposit",
  amount: Centimes,
  paidOn: string,
  payerName: string,
) {
  await recordRentPayment(
    cashier,
    recordRentPaymentSchema.parse({
      leaseId,
      kind,
      amount: asInput(amount),
      method: "bank_transfer",
      paidOn,
      reference: kind === "deposit" ? "VIR-DEPOT" : "VIR-LOYER",
      bank: "",
      payerName,
      notes: "",
    }),
  );
}

/** Pays each rent period on its due day, up to the given number of periods. */
async function payPeriods(actors: Actors, leaseId: string, periods: number, payer: string) {
  const current = await getLease(actors.manager, leaseId);
  for (const line of (current?.statement.lines ?? []).slice(0, periods)) {
    await pay(actors, leaseId, "rent", line.amount, line.dueOn, payer);
  }
}

async function inspect(
  { manager }: Actors,
  leaseId: string,
  kind: "check_in" | "check_out",
  inspectedOn: string,
  items: { element: string; condition: "good" | "fair" | "poor"; notes?: string }[],
  meters: { electricity: string; water: string; keys: string },
) {
  await recordInspection(
    manager,
    recordInspectionSchema.parse({
      leaseId,
      kind,
      inspectedOn,
      items: items.map((i) => ({ ...i, notes: i.notes ?? "" })),
      electricityMeter: meters.electricity,
      gasMeter: "",
      waterMeter: meters.water,
      keysCount: meters.keys,
      observations: "",
    }),
  );
}

export async function seedRentals(actors: Actors) {
  const today = todayInAlgiers();

  // The pharmacy in the shop kept at El Yasmine: the current quarter is overdue.
  const pharmacy = await lease(actors, {
    project: "YASM",
    unit: "Y-00-02",
    kind: "commercial",
    tenantName: "SARL Pharmacie El Yasmine",
    tenantNameAr: "صيدلية الياسمين",
    tenantIdNumber: "16/00-0451877B22",
    tenantPhone: "0550 77 31 20",
    activity: "Pharmacie",
    startDaysAgo: 400,
    durationMonths: 36,
    monthlyRent: "60 000",
    monthlyCharges: "5 000",
    frequency: "quarterly",
    deposit: "195 000",
  });
  await pay(actors, pharmacy, "deposit", 195_000_00n, addDays(today, -407), "Pharmacie El Yasmine");
  await payPeriods(actors, pharmacy, 4, "Pharmacie El Yasmine");
  // Its second year is indexed by 3 % (the quarter now overdue is due at the new rent).
  await reviseRent(
    actors.manager,
    reviseRentSchema.parse({
      leaseId: pharmacy,
      effectiveOn: addMonths(addDays(today, -400), 12),
      monthlyRent: "61 800",
      monthlyCharges: "5 000",
      reason: "Indexation annuelle de 3 % (article 5 du bail)",
    }),
  );
  // Last year's charges settled against its provisions: 4 500 DA more, due within 20 days.
  const lastYear = Number(today.slice(0, 4)) - 1;
  const choice = (await getLease(actors.manager, pharmacy))?.settlementChoices.find(
    (c) => c.year === lastYear,
  );
  if (choice) {
    await settleLeaseCharges(
      actors.manager,
      settleLeaseChargesSchema.parse({
        leaseId: pharmacy,
        year: String(lastYear),
        actual: asInput(choice.provisions + 4_500_00n),
        dueOn: addDays(today, 20),
        note: "Décompte des charges de la résidence El Yasmine",
      }),
    );
  }
  await inspect(
    actors,
    pharmacy,
    "check_in",
    addDays(today, -400),
    [
      { element: "Façade et vitrine", condition: "good" },
      { element: "Rideau métallique", condition: "good" },
      { element: "Salle", condition: "good" },
      { element: "Réserve", condition: "fair", notes: "Peinture à rafraîchir" },
      { element: "Sanitaires", condition: "good" },
    ],
    { electricity: "002147", water: "0388", keys: "4" },
  );

  // A family at Les Amandiers: rent paid to date, the term ends in about six weeks.
  const family = await lease(actors, {
    project: "AMND",
    unit: "D-03-03",
    kind: "residential",
    tenantName: "Hamidi Yasmine",
    tenantNameAr: "حميدي ياسمين",
    tenantPhone: "0661 48 20 73",
    tenantEmail: "y.hamidi@example.test",
    whatsapp: true,
    guarantor: { name: "Hamidi Rachid", idNumber: "109870123456789012", phone: "0550 12 98 76" },
    startDaysAgo: 320,
    durationMonths: 12,
    monthlyRent: "35 000",
    frequency: "monthly",
    deposit: "70 000",
  });
  await pay(actors, family, "deposit", 70_000_00n, addDays(today, -327), "Yasmine Hamidi");
  await payPeriods(actors, family, 11, "Yasmine Hamidi");
  await inspect(
    actors,
    family,
    "check_in",
    addDays(today, -320),
    [
      { element: "Entrée", condition: "good" },
      { element: "Séjour", condition: "good" },
      { element: "Cuisine", condition: "good" },
      { element: "Chambres", condition: "good" },
      { element: "Salle de bain", condition: "good" },
    ],
    { electricity: "000412", water: "0057", keys: "3" },
  );

  // A tenant who left last spring: exit inspection, part of the deposit kept for the paint.
  const left = await lease(actors, {
    project: "AMND",
    unit: "D-00-03",
    kind: "residential",
    tenantName: "Kaci Nabil",
    tenantNameAr: "قاسي نبيل",
    tenantPhone: "0770 63 18 44",
    startDaysAgo: 500,
    durationMonths: 12,
    monthlyRent: "32 000",
    frequency: "monthly",
    deposit: "64 000",
  });
  const rooms = ["Entrée", "Séjour", "Cuisine", "Chambres", "Salle de bain"];
  await pay(actors, left, "deposit", 64_000_00n, addDays(today, -507), "Nabil Kaci");
  await payPeriods(actors, left, 12, "Nabil Kaci");
  await inspect(
    actors,
    left,
    "check_in",
    addDays(today, -500),
    rooms.map((element) => ({ element, condition: "good" as const })),
    { electricity: "000108", water: "0011", keys: "3" },
  );
  await inspect(
    actors,
    left,
    "check_out",
    addDays(today, -150),
    rooms.map((element) =>
      element === "Séjour"
        ? { element, condition: "fair" as const, notes: "Murs tachés, peinture à reprendre" }
        : { element, condition: "good" as const },
    ),
    { electricity: "003961", water: "0402", keys: "3" },
  );
  await endLease(
    actors.manager,
    endLeaseSchema.parse({
      leaseId: left,
      endedOn: addDays(today, -150),
      reason: "Mutation professionnelle à Oran",
    }),
  );
  await settleDeposit(
    actors.manager,
    settleDepositSchema.parse({
      leaseId: left,
      settledOn: addDays(today, -140),
      refunded: "54 000",
      reason: "Remise en peinture du séjour",
    }),
  );
}
