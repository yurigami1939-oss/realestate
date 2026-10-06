/**
 * Demo sales (module 3), dated relative to today (Algiers) so the demo always shows the same
 * situations: a VSP with its commission and bank loan, an overdue reservation with a reminder
 * letter, a cheque awaiting clearance, a withdrawal awaiting the gérant, an option, and a
 * validated milestone with its payment calls. Their PDFs render when `pnpm worker` runs.
 */
import { addDays, todayInAlgiers } from "@/lib/dates";
import { type Centimes, toDecimalString } from "@/lib/money";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema, setBuyerDocumentSchema } from "@/server/buyers/schemas";
import { createBuyer, setBuyerDocument } from "@/server/buyers/service";
import { issueReminderSchema } from "@/server/collections/schemas";
import { issueReminderLetter } from "@/server/collections/service";
import { commissionRatesSchema } from "@/server/commissions/schemas";
import { saveCommissionRates } from "@/server/commissions/service";
import { companySettingsSchema } from "@/server/organizations/schemas";
import { updateCompanySettings } from "@/server/organizations/settings";
import { validateMilestoneSchema } from "@/server/payment-calls/schemas";
import { issueMilestonePaymentCalls, validateMilestone } from "@/server/payment-calls/service";
import { getProjectPaymentSetup } from "@/server/payment-plans/queries";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { createBankLoan } from "@/server/sales/bank-loans";
import { placeOption } from "@/server/sales/options";
import { createReservation, recordSale } from "@/server/sales/reservations";
import { getSale } from "@/server/sales/sale-queries";
import {
  createBankLoanSchema,
  createReservationSchema,
  proposeWithdrawalSchema,
  recordSaleSchema,
} from "@/server/sales/schemas";
import { proposeWithdrawal } from "@/server/sales/withdrawals";

import { demoOrganizations } from "./demo";

type Actors = {
  owner: TenantCtx;
  manager: TenantCtx;
  agentA: TenantCtx;
  agentB: TenantCtx;
  cashier: TenantCtx;
};

type Ids = {
  projects: Map<string, string>;
  units: Map<string, string>;
  leads: Map<string, string>;
  /** Default plan per project code. */
  plans: Map<string, string>;
};

const asInput = (amount: Centimes) => toDecimalString(amount).replace(".", ",");

const need = (map: Map<string, string>, key: string) => {
  const value = map.get(key);
  if (!value) throw new Error(`seed: ${key} missing`);
  return value;
};

/** Company sales settings: commission, late penalties (shown only), option duration. */
async function seedSettings(owner: TenantCtx) {
  const company = demoOrganizations[0];
  await updateCompanySettings(
    owner,
    companySettingsSchema.parse({
      name: company.name,
      legalName: company.legalName,
      address: company.address,
      wilaya: company.wilaya,
      phone: company.phone,
      rcNumber: company.rcNumber,
      nif: company.nif,
      nis: company.nis,
      aiNumber: company.aiNumber,
      quotationValidityDays: "15",
      optionHours: "48",
      paymentCallDelayDays: "15",
      withdrawalRetention: "10",
      penaltyMonthlyRate: "1",
      penaltyGraceDays: "5",
      penaltyCap: "10",
      defaultCommissionRate: "1",
      deliveryPenaltyMonthlyRate: "0,5",
      deliveryPenaltyCap: "10",
      formalNoticeDays: "15",
      formalNoticesRequired: "2",
      terminationRetention: "10",
      fgcmpiNumber: "FGCMPI-16-0482",
      vspLimitSigning: "",
      vspLimitFoundations: "",
      vspLimitStructure: "",
      vspLimitCompletion: "",
    }),
  );
}

type BuyerSpec = {
  by: TenantCtx;
  lead: string | null;
  civility: "mr" | "mrs";
  lastName: string;
  firstName: string;
  lastNameAr: string;
  firstNameAr: string;
  birthDate: string;
  birthPlace: string;
  nin: string;
  phone: string;
  address: string;
  commune: string;
  wilaya: string;
  profession: string;
  maritalStatus: "single" | "married";
  received: ("id_card" | "birth_certificate" | "family_record" | "residence_certificate")[];
};

async function buyerOf(spec: BuyerSpec, leads: Map<string, string>) {
  const { id } = await createBuyer(
    spec.by,
    createBuyerSchema.parse({
      civility: spec.civility,
      lastName: spec.lastName,
      firstName: spec.firstName,
      lastNameAr: spec.lastNameAr,
      firstNameAr: spec.firstNameAr,
      birthDate: spec.birthDate,
      birthPlace: spec.birthPlace,
      nin: spec.nin,
      phone: spec.phone,
      address: spec.address,
      commune: spec.commune,
      wilaya: spec.wilaya,
      profession: spec.profession,
      maritalStatus: spec.maritalStatus,
      leadId: spec.lead ? need(leads, spec.lead) : "",
    }),
  );
  for (const [index, kind] of spec.received.entries()) {
    await setBuyerDocument(
      spec.by,
      setBuyerDocumentSchema.parse({
        buyerId: id,
        kind,
        status: index === 0 ? "verified" : "received",
        note: "",
      }),
    );
  }
  return id;
}

export async function seedSales(actors: Actors, ids: Ids) {
  const { owner, manager, agentA, agentB, cashier } = actors;
  const today = todayInAlgiers();
  await seedSettings(owner);
  await saveCommissionRates(
    owner,
    commissionRatesSchema.parse({ rates: [{ userId: agentA.userId, rate: "1,5" }] }),
  );

  const karima = await buyerOf(
    {
      by: agentA,
      lead: "Karima Boudiaf",
      civility: "mrs",
      lastName: "Boudiaf",
      firstName: "Karima",
      lastNameAr: "بوضياف",
      firstNameAr: "كريمة",
      birthDate: "1986-04-12",
      birthPlace: "Alger",
      nin: "109861234500456789",
      phone: "0555 71 64 82",
      address: "15, cité des Vergers",
      commune: "Kouba",
      wilaya: "16 - Alger",
      profession: "Médecin",
      maritalStatus: "married",
      received: ["id_card", "birth_certificate", "family_record", "residence_certificate"],
    },
    ids.leads,
  );
  const houda = await buyerOf(
    {
      by: agentB,
      lead: "Houda Meziane",
      civility: "mrs",
      lastName: "Meziane",
      firstName: "Houda",
      lastNameAr: "مزيان",
      firstNameAr: "هدى",
      birthDate: "1991-09-03",
      birthPlace: "Blida",
      nin: "109910987600123456",
      phone: "0770 41 26 83",
      address: "Rue des Frères Bouadou",
      commune: "Bir Mourad Raïs",
      wilaya: "16 - Alger",
      profession: "Ingénieure",
      maritalStatus: "single",
      received: ["id_card"],
    },
    ids.leads,
  );
  const djamel = await buyerOf(
    {
      by: manager,
      lead: "Djamel Benchikh",
      civility: "mr",
      lastName: "Benchikh",
      firstName: "Djamel",
      lastNameAr: "بن شيخ",
      firstNameAr: "جمال",
      birthDate: "1978-01-27",
      birthPlace: "Tizi Ouzou",
      nin: "109780456700987654",
      phone: "0661 93 40 17",
      address: "Lotissement El Bina, villa 22",
      commune: "Dely Ibrahim",
      wilaya: "16 - Alger",
      profession: "Commerçant",
      maritalStatus: "married",
      received: ["id_card", "family_record"],
    },
    ids.leads,
  );
  const djamelSpouse = await buyerOf(
    {
      by: manager,
      lead: null,
      civility: "mrs",
      lastName: "Benchikh",
      firstName: "Samia",
      lastNameAr: "بن شيخ",
      firstNameAr: "سامية",
      birthDate: "1982-06-15",
      birthPlace: "Alger",
      nin: "109820456700112233",
      phone: "0661 93 40 18",
      address: "Lotissement El Bina, villa 22",
      commune: "Dely Ibrahim",
      wilaya: "16 - Alger",
      profession: "Enseignante",
      maritalStatus: "married",
      received: ["id_card"],
    },
    ids.leads,
  );
  const walid = await buyerOf(
    {
      by: agentB,
      lead: "Walid Cherfaoui",
      civility: "mr",
      lastName: "Cherfaoui",
      firstName: "Walid",
      lastNameAr: "شرفاوي",
      firstNameAr: "وليد",
      birthDate: "1989-11-30",
      birthPlace: "Boumerdès",
      nin: "109891122300445566",
      phone: "0552 18 74 39",
      address: "Cité 500 logements, bât. 12",
      commune: "Rouiba",
      wilaya: "16 - Alger",
      profession: "Technicien",
      maritalStatus: "single",
      received: [],
    },
    ids.leads,
  );
  // A buyer file opened ahead of a reservation (visited prospect).
  await buyerOf(
    {
      by: manager,
      lead: "Assia Lounis",
      civility: "mrs",
      lastName: "Lounis",
      firstName: "Assia",
      lastNameAr: "لونيس",
      firstNameAr: "آسيا",
      birthDate: "1993-02-08",
      birthPlace: "Béjaïa",
      nin: "109930778800990011",
      phone: "0698 55 31 07",
      address: "Boulevard Krim Belkacem",
      commune: "Alger-Centre",
      wilaya: "16 - Alger",
      profession: "Pharmacienne",
      maritalStatus: "single",
      received: ["id_card", "birth_certificate"],
    },
    ids.leads,
  );

  const reserve = async (
    by: TenantCtx,
    spec: {
      unit: string;
      buyers: string[];
      plan: string;
      discount?: string;
      daysAgo: number;
      notary?: string;
    },
  ) => {
    const { id } = await createReservation(
      by,
      createReservationSchema.parse({
        unitId: need(ids.units, spec.unit),
        buyerIds: spec.buyers,
        paymentPlanId: spec.plan,
        discount: spec.discount ?? "",
        reservedOn: addDays(today, -spec.daysAgo),
        notary: spec.notary ?? "Maître Hamidi Fatiha",
        reference: "",
        notes: "",
      }),
    );
    const sale = await getSale(manager, id);
    if (!sale) throw new Error("seed: reservation not found");
    return sale;
  };
  const pay = (
    reservationId: string,
    amount: Centimes,
    daysAgo: number,
    payerName: string,
    method: "cash" | "cheque" | "bank_transfer" | "bank_loan" = "cash",
  ) =>
    recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId,
        amount: asInput(amount),
        method,
        paidOn: addDays(today, -daysAgo),
        reference: method === "cheque" ? "0045871" : method === "bank_transfer" ? "VIR-77120" : "",
        bank: method === "cheque" ? "BNA, agence Kouba" : "",
        payerName,
      }),
    );

  const olivPlan = need(ids.plans, "OLIV");
  const { plans: olivPlans, milestones: olivMilestones } = await getProjectPaymentSetup(
    manager,
    need(ids.projects, "OLIV"),
  );
  const instalmentPlan = olivPlans.find((p) => p.name === "Paiement échelonné 24 mois")?.id;
  if (!instalmentPlan) throw new Error("seed: 24-month plan missing");

  // 1. Karima Boudiaf: signing paid in two payments, VSP signed, commission, bank loan.
  const karimaSale = await reserve(agentA, {
    unit: "A-04-03",
    buyers: [karima],
    plan: olivPlan,
    daysAgo: 95,
  });
  const signing = karimaSale.installments[0]?.amount ?? 0n;
  await pay(karimaSale.id, 200_000_000n, 95, "Karima Boudiaf");
  await pay(karimaSale.id, signing - 200_000_000n, 75, "Karima Boudiaf", "bank_transfer");
  await recordSale(
    manager,
    recordSaleSchema.parse({
      reservationId: karimaSale.id,
      signedOn: addDays(today, -30),
      notary: "Maître Hamidi Fatiha",
      reference: "Rép. 2026/1184",
    }),
  );
  await createBankLoan(
    manager,
    createBankLoanSchema.parse({
      reservationId: karimaSale.id,
      bank: "CNEP-Banque, agence Kouba",
      requested: "9 000 000",
      approved: "8 500 000",
      status: "approved",
      submittedOn: addDays(today, -60),
      decidedOn: addDays(today, -35),
      reference: "CNEP/IMMO/2026/0412",
      notes: "Déblocage par tranches sur appels de fonds.",
    }),
  );
  await pay(karimaSale.id, 300_000_000n, 10, "CNEP-Banque", "bank_loan");

  // 2. Houda Meziane: half of the signing paid, the rest overdue; a reminder letter.
  const houdaSale = await reserve(agentB, {
    unit: "B-03-02",
    buyers: [houda],
    plan: olivPlan,
    daysAgo: 40,
  });
  await pay(houdaSale.id, (houdaSale.installments[0]?.amount ?? 0n) / 2n, 40, "Houda Meziane");

  // 3. Djamel and Samia Benchikh: discounted, 24-month plan, cheque awaiting clearance.
  const djamelSale = await reserve(manager, {
    unit: "A-08-01",
    buyers: [djamel, djamelSpouse],
    plan: instalmentPlan,
    discount: "600 000",
    daysAgo: 12,
  });
  await pay(
    djamelSale.id,
    djamelSale.installments[0]?.amount ?? 0n,
    12,
    "Djamel Benchikh",
    "cheque",
  );

  // 4. Walid Cherfaoui: withdrawal proposed by the directrice commerciale.
  const walidSale = await reserve(agentB, {
    unit: "C-04-02",
    buyers: [walid],
    plan: need(ids.plans, "CORN"),
    daysAgo: 60,
  });
  await pay(walidSale.id, walidSale.installments[0]?.amount ?? 0n, 60, "Walid Cherfaoui");
  await proposeWithdrawal(
    manager,
    proposeWithdrawalSchema.parse({
      reservationId: walidSale.id,
      retention: "10",
      reason: "Mutation professionnelle à Oran ; demande écrite reçue.",
    }),
  );

  // 5. An option for a visited prospect.
  await placeOption(agentA, {
    unitId: need(ids.units, "A-06-03"),
    leadId: need(ids.leads, "Rachid Ould Ali"),
  });

  // The gros œuvre of Les Oliviers is reached: its installments fall due, calls are issued.
  const structure = olivMilestones.find((m) => m.name === "Achèvement du gros œuvre");
  if (!structure) throw new Error("seed: milestone missing");
  await validateMilestone(
    manager,
    validateMilestoneSchema.parse({ milestoneId: structure.id, validatedOn: addDays(today, -3) }),
  );
  await issueMilestonePaymentCalls(manager.orgId, structure.id);

  await issueReminderLetter(
    cashier,
    issueReminderSchema.parse({ reservationId: houdaSale.id, payBy: addDays(today, 8) }),
  );
}
