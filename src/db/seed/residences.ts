/**
 * Demo residence management (module 6): « Résidence El Yasmine », a building delivered in 2023,
 * before the app — its project is `delivered`, the units sold then are marked delivered before
 * the app (module 4) and the shop the company kept is blocked — whose co-owners were entered by
 * hand. Charges (categories, an approved
 * budget, two quarters called: the first overdue for two co-owners, one of whom got a reminder
 * letter), suppliers with a contract and invoices, two agents with attendance, an advance and
 * their pay, tickets, a closed general assembly with its PV, an upcoming one and announcements.
 * Dated relative to today (Algiers); their PDFs render when `pnpm worker` runs.
 */
import { eq } from "drizzle-orm";
import type { z } from "zod";

import { generalAssembly } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { Majority } from "@/lib/assemblies";
import { addDays, addMonths, fromAlgiersDateTime, todayInAlgiers } from "@/lib/dates";
import { defaultUnitCode, type Typology } from "@/lib/inventory";
import { type Centimes, toDecimalString } from "@/lib/money";
import { createAnnouncementSchema } from "@/server/announcements/schemas";
import {
  archiveAnnouncement,
  createAnnouncement,
  publishAnnouncement,
} from "@/server/announcements/service";
import {
  addResolutionSchema,
  closeAssemblySchema,
  createAssemblySchema,
  saveAttendanceSchema as saveAssemblyAttendanceSchema,
  saveVotesSchema,
} from "@/server/assemblies/schemas";
import {
  addResolution,
  closeAssembly,
  conveneAssembly,
  createAssembly,
  saveAttendance as saveAssemblyAttendance,
  saveVotes,
} from "@/server/assemblies/service";
import type { TenantCtx } from "@/server/auth/session";
import { approveBudget, saveBudget } from "@/server/charges/budgets";
import { issueChargePeriod } from "@/server/charges/calls";
import { createChargeCategory } from "@/server/charges/categories";
import { issueChargeReminder } from "@/server/charges/collections";
import { recordChargePayment } from "@/server/charges/payments";
import { getChargePeriod } from "@/server/charges/queries";
import {
  createChargeCategorySchema,
  issueChargePeriodSchema,
  issueChargeReminderSchema,
  recordChargePaymentSchema,
  saveBudgetSchema,
} from "@/server/charges/schemas";
import {
  createBuildingSchema,
  createProjectSchema,
  createUnitSchema,
  unitStatusReasonSchema,
} from "@/server/inventory/schemas";
import { pastDeliveriesSchema } from "@/server/handovers/schemas";
import { recordPastDeliveries } from "@/server/handovers/service";
import { blockUnit, createBuilding, createProject, createUnit } from "@/server/inventory/service";
import { createCheckSchema, recordVisitSchema } from "@/server/maintenance/schemas";
import { createCheck, recordVisit } from "@/server/maintenance/service";
import { addResidentSchema, createResidenceSchema } from "@/server/residences/schemas";
import { addResident, createResidence, distributeSharesByArea } from "@/server/residences/service";
import { saveAttendance as saveStaffAttendance } from "@/server/staff/attendance";
import { payStaff, savePay } from "@/server/staff/pay";
import {
  createStaffSchema,
  payStaffSchema,
  recordAdvanceSchema,
  saveAttendanceSchema as saveStaffAttendanceSchema,
  savePaySchema,
} from "@/server/staff/schemas";
import { createStaff, recordAdvance } from "@/server/staff/service";
import { payInvoice, recordInvoice } from "@/server/suppliers/invoices";
import {
  createContractSchema,
  createInvoiceSchema,
  createSupplierSchema,
  payInvoiceSchema,
} from "@/server/suppliers/schemas";
import { createContract, createSupplier } from "@/server/suppliers/service";
import {
  assignTicketSchema,
  changeTicketStatusSchema,
  commentTicketSchema,
  createTicketSchema,
} from "@/server/tickets/schemas";
import {
  assignTicket,
  changeTicketStatus,
  commentTicket,
  createTicket,
} from "@/server/tickets/service";

type Actors = {
  owner: TenantCtx;
  /** The gestionnaire (property manager). */
  manager: TenantCtx;
  cashier: TenantCtx;
};

export const DEMO_RESIDENCE = "Résidence El Yasmine";

const BUILDING = "Y";
const DELIVERED = "Livrée en juin 2023, vendue avant l'application";
/** Co-owners since the deliveries that followed the handover. */
const SINCE = "2023-07-01";

const asInput = (amount: Centimes) => toDecimalString(amount).replace(".", ",");

const code = (floor: number, position: number) => defaultUnitCode(BUILDING, floor, position);

type UnitSpec = {
  floor: number;
  position: number;
  type: "apartment" | "commercial";
  typology?: Typology;
  livingArea?: string;
  usableArea?: string;
};

/** Two shops on the ground floor, three flats on each of the four floors. */
const units: UnitSpec[] = [
  { floor: 0, position: 1, type: "commercial", usableArea: "62" },
  { floor: 0, position: 2, type: "commercial", usableArea: "48" },
  ...[1, 2, 3, 4].flatMap((floor): UnitSpec[] => [
    { floor, position: 1, type: "apartment", typology: "F3", livingArea: "85,40" },
    { floor, position: 2, type: "apartment", typology: "F4", livingArea: "108,20" },
    { floor, position: 3, type: "apartment", typology: "F3", livingArea: "86,10" },
  ]),
];

type CoOwner = {
  unit: string;
  lastName: string;
  firstName: string;
  lastNameAr?: string;
  firstNameAr?: string;
  phone?: string;
  email?: string;
  isMain?: boolean;
  /** Agreed to WhatsApp notifications. */
  whatsapp?: boolean;
};

/** Y-00-02 (a shop) is still the promoter's. Mohamed Cherif is the demo resident account. */
const coOwners: CoOwner[] = [
  { unit: code(0, 1), lastName: "Bensaïd", firstName: "Lotfi", phone: "0550 41 22 18" },
  {
    unit: code(1, 1),
    lastName: "Cherif",
    firstName: "Mohamed",
    lastNameAr: "شريف",
    firstNameAr: "محمد",
    phone: "0661 50 12 34",
    email: "acquereur@demo.test",
    whatsapp: true,
  },
  {
    unit: code(1, 2),
    lastName: "Amrani",
    firstName: "Souad",
    lastNameAr: "عمراني",
    firstNameAr: "سعاد",
  },
  { unit: code(1, 3), lastName: "Djebbar", firstName: "Nassim", phone: "0770 11 45 90" },
  {
    unit: code(2, 1),
    lastName: "Hadjadj",
    firstName: "Lamia",
    lastNameAr: "حجاج",
    firstNameAr: "لمياء",
    phone: "0551 63 28 47",
  },
  { unit: code(2, 2), lastName: "Bouchama", firstName: "Rafik" },
  { unit: code(2, 2), lastName: "Bouchama", firstName: "Nora", isMain: false },
  {
    unit: code(2, 3),
    lastName: "Mebarki",
    firstName: "Farid",
    lastNameAr: "مباركي",
    firstNameAr: "فريد",
    phone: "0662 70 81 92",
    whatsapp: true,
  },
  { unit: code(3, 1), lastName: "Ouchene", firstName: "Samir" },
  { unit: code(3, 2), lastName: "Zitouni", firstName: "Nadia", email: "n.zitouni@example.test" },
  { unit: code(3, 3), lastName: "Brahimi", firstName: "Omar", phone: "0772 30 66 15" },
  { unit: code(4, 1), lastName: "Larbi", firstName: "Hakim" },
  { unit: code(4, 2), lastName: "Mokrani", firstName: "Djamila", phone: "0554 82 19 03" },
  { unit: code(4, 3), lastName: "Kaddour", firstName: "Walid" },
];

const need = (map: Map<string, string>, key: string) => {
  const value = map.get(key);
  if (!value) throw new Error(`seed: ${key} missing`);
  return value;
};

/** The delivered project, its building and units. */
async function seedBuilding(owner: TenantCtx) {
  const { id: projectId } = await createProject(
    owner,
    createProjectSchema.parse({
      code: "YASM",
      name: DEMO_RESIDENCE,
      status: "delivered",
      address: "Lotissement El Yasmine, lot 7",
      wilaya: "Alger",
      commune: "Chéraga",
      launchedOn: "2021-03-01",
      plannedDeliveryOn: "2023-06-30",
      description: "Bloc unique livré en juin 2023, géré par la société depuis la livraison.",
    }),
  );
  const { id: buildingId } = await createBuilding(
    owner,
    createBuildingSchema.parse({
      projectId,
      code: BUILDING,
      name: "Bloc Y",
      lowestFloor: "0",
      topFloor: "4",
    }),
  );
  const unitIds = new Map<string, string>();
  for (const spec of units) {
    const unitCode = code(spec.floor, spec.position);
    const { id } = await createUnit(
      owner,
      createUnitSchema.parse({
        buildingId,
        code: unitCode,
        floor: String(spec.floor),
        type: spec.type,
        typology: spec.typology ?? "",
        isDuplex: false,
        livingArea: spec.livingArea ?? "",
        usableArea: spec.usableArea ?? "",
        orientations: [],
      }),
    );
    unitIds.set(unitCode, id);
  }
  return { projectId, unitIds };
}

/** Five categories, an approved budget for the year and its reserve fund. */
async function seedCharges(manager: TenantCtx, residenceId: string, unitIds: Map<string, string>) {
  const category = async (
    name: string,
    nameAr: string,
    key: "share" | "equal" | "custom",
    unitList: string[] = [],
  ) =>
    (
      await createChargeCategory(
        manager,
        createChargeCategorySchema.parse({
          residenceId,
          name,
          nameAr,
          key,
          weighting: "share",
          buildingId: "",
          unitIds: unitList,
        }),
      )
    ).id;
  const flats = units
    .filter((u) => u.type === "apartment")
    .map((u) => need(unitIds, code(u.floor, u.position)));
  const categories = {
    cleaning: await category("Nettoyage des parties communes", "تنظيف الأجزاء المشتركة", "share"),
    security: await category("Gardiennage", "الحراسة", "share"),
    electricity: await category(
      "Électricité des parties communes",
      "كهرباء الأجزاء المشتركة",
      "share",
    ),
    // The shops on the ground floor do not use the lift.
    lift: await category("Ascenseur", "المصعد", "custom", flats),
    garden: await category("Espaces verts", "المساحات الخضراء", "equal"),
  };
  const year = Number(todayInAlgiers().slice(0, 4));
  const { budgetId } = await saveBudget(
    manager,
    saveBudgetSchema.parse({
      residenceId,
      year: String(year),
      lines: [
        { categoryId: categories.cleaning, amount: "432 000" },
        { categoryId: categories.security, amount: "504 000" },
        { categoryId: categories.electricity, amount: "144 000" },
        { categoryId: categories.lift, amount: "192 000" },
        { categoryId: categories.garden, amount: "48 000" },
      ],
      notes: "Voté par l'assemblée générale ordinaire.",
    }),
  );
  await approveBudget(manager, budgetId);
  return { categories, budgetId };
}

/**
 * Two quarters called: the first is due since 45 days (paid by everyone but Mebarki, unpaid,
 * who got a reminder letter, and Brahimi, half paid); the second is due in 20 days (a few
 * co-owners paid in advance, one by a cheque not cleared yet).
 */
async function seedCalls(
  { manager, cashier }: Actors,
  residenceId: string,
  budgetId: string,
  unitIds: Map<string, string>,
) {
  const today = todayInAlgiers();
  const issue = (index: number, issuedOn: string, dueOn: string) =>
    issueChargePeriod(
      manager,
      issueChargePeriodSchema.parse({ period: `${budgetId}:${index}`, issuedOn, dueOn }),
    );
  const first = await issue(1, addDays(today, -75), addDays(today, -45));
  const second = await issue(2, addDays(today, -10), addDays(today, 20));
  const calls = async (periodId: string) => {
    const period = await getChargePeriod(manager, periodId);
    if (!period) throw new Error("seed: charge period missing");
    return new Map(period.calls.map((c) => [c.unitCode, c]));
  };
  const firstCalls = await calls(first.periodId);
  const secondCalls = await calls(second.periodId);
  const pay = async (
    unitCode: string,
    amount: Centimes,
    paidOn: string,
    payerName: string,
    method: "cash" | "cheque" | "bank_transfer" | "ccp" = "cash",
  ) =>
    recordChargePayment(
      cashier,
      recordChargePaymentSchema.parse({
        residenceId,
        unitId: need(unitIds, unitCode),
        amount: asInput(amount),
        method,
        paidOn,
        reference: method === "cheque" ? "4410276" : method === "bank_transfer" ? "VIR-0917" : "",
        bank: method === "cheque" ? "BNA Chéraga" : "",
        payerName,
        notes: "",
      }),
    );
  const ownerName = (unitCode: string) => {
    const main = coOwners.find((c) => c.unit === unitCode && c.isMain !== false);
    return main ? `${main.lastName} ${main.firstName}` : "SARL El Bahdja Immobilier";
  };
  for (const [unitCode, call] of firstCalls) {
    if (unitCode === code(2, 3)) continue;
    const half = unitCode === code(3, 3);
    await pay(
      unitCode,
      half ? call.amount / 2n : call.amount,
      addDays(today, -60 + (Number(unitCode.slice(-2)) % 10)),
      ownerName(unitCode),
      unitCode === code(0, 2) ? "bank_transfer" : "cash",
    );
  }
  for (const unitCode of [code(1, 1), code(2, 1), code(4, 2)]) {
    const call = secondCalls.get(unitCode);
    if (call) await pay(unitCode, call.amount, addDays(today, -5), ownerName(unitCode));
  }
  const cheque = secondCalls.get(code(3, 2));
  if (cheque) {
    await pay(code(3, 2), cheque.amount, addDays(today, -2), ownerName(code(3, 2)), "cheque");
  }
  await issueChargeReminder(
    cashier,
    issueChargeReminderSchema.parse({
      residenceId,
      unitId: need(unitIds, code(2, 3)),
      payBy: addDays(today, 8),
    }),
  );
}

/** A lift maintenance contract, invoices (paid, unpaid, works paid from the reserve fund). */
async function seedSuppliers(
  manager: TenantCtx,
  residenceId: string,
  categories: Awaited<ReturnType<typeof seedCharges>>["categories"],
) {
  const today = todayInAlgiers();
  const year = today.slice(0, 4);
  const supplier = async (name: string, activity: string, phone: string) =>
    (
      await createSupplier(
        manager,
        createSupplierSchema.parse({ name, activity, phone, nif: "", rcNumber: "", rib: "" }),
      )
    ).id;
  const lifts = await supplier("Ascenseurs Hamma", "Maintenance d'ascenseurs", "023 45 12 78");
  const electrician = await supplier(
    "Électricité Générale Bouzaréah",
    "Électricité",
    "0552 14 63 20",
  );
  const roofer = await supplier("Étanchéité Moderne", "Étanchéité", "0560 33 71 08");
  const { id: contractId } = await createContract(
    manager,
    createContractSchema.parse({
      supplierId: lifts,
      residenceId,
      categoryId: categories.lift,
      label: "Maintenance préventive de l'ascenseur",
      startOn: "2024-01-01",
      endOn: "",
      annualAmount: "144 000",
      notes: "Visite mensuelle, dépannage sous 24 h.",
    }),
  );
  const invoice = async (
    supplierId: string,
    fields: {
      number: string;
      label: string;
      amount: string;
      invoiceOn: string;
      categoryId?: string;
      contractId?: string;
      fromReserve?: boolean;
    },
  ) =>
    (
      await recordInvoice(
        manager,
        createInvoiceSchema.parse({
          supplierId,
          residenceId,
          categoryId: fields.categoryId ?? "",
          contractId: fields.contractId ?? "",
          number: fields.number,
          invoiceOn: fields.invoiceOn,
          dueOn: addDays(fields.invoiceOn, 30),
          label: fields.label,
          amount: fields.amount,
          fromReserve: fields.fromReserve ?? false,
          notes: "",
        }),
      )
    ).id;
  const pay = (invoiceId: string, paidOn: string, method: "bank_transfer" | "cheque") =>
    payInvoice(
      manager,
      payInvoiceSchema.parse({
        invoiceId,
        paidOn,
        method,
        reference: method === "cheque" ? "2208741" : "VIR-1104",
      }),
    );
  const maintenance = await invoice(lifts, {
    number: `AH-${year}-031`,
    label: "Maintenance du trimestre",
    amount: "36 000",
    invoiceOn: addDays(today, -70),
    categoryId: categories.lift,
    contractId,
  });
  await pay(maintenance, addDays(today, -55), "bank_transfer");
  await invoice(lifts, {
    number: `AH-${year}-077`,
    label: "Remplacement du câble de porte palière",
    amount: "28 500",
    invoiceOn: addDays(today, -6),
    categoryId: categories.lift,
    contractId,
  });
  const lights = await invoice(electrician, {
    number: "EGB-0412",
    label: "Remplacement des luminaires du hall",
    amount: "23 400",
    invoiceOn: addDays(today, -40),
    categoryId: categories.electricity,
  });
  await pay(lights, addDays(today, -30), "cheque");
  const works = await invoice(roofer, {
    number: `EM-${year}-018`,
    label: "Reprise de l'étanchéité de la cage d'escalier",
    amount: "14 000",
    invoiceOn: addDays(today, -20),
    fromReserve: true,
  });
  await pay(works, addDays(today, -12), "bank_transfer");
  return { lifts };
}

/** A guard and a cleaner: last month's attendance and pay (paid), an advance this month. */
async function seedStaff(
  manager: TenantCtx,
  residenceId: string,
  categories: Awaited<ReturnType<typeof seedCharges>>["categories"],
) {
  const today = todayInAlgiers();
  const thisMonth = `${today.slice(0, 7)}-01`;
  const lastMonth = addMonths(thisMonth, -1);
  const agent = async (
    role: "security" | "cleaning",
    lastName: string,
    firstName: string,
    salary: string,
    categoryId: string,
  ) =>
    (
      await createStaff(
        manager,
        createStaffSchema.parse({
          residenceId,
          role,
          lastName,
          firstName,
          phone: "",
          nin: "",
          hiredOn: SINCE,
          monthlySalary: salary,
          categoryId,
          notes: "",
        }),
      )
    ).id;
  const guard = await agent("security", "Belhadj", "Rabah", "42 000", categories.security);
  const cleaner = await agent("cleaning", "Hamel", "Kheira", "36 000", categories.cleaning);
  await saveStaffAttendance(
    manager,
    saveStaffAttendanceSchema.parse({
      residenceId,
      month: lastMonth.slice(0, 7),
      marks: [
        { staffId: guard, day: addDays(lastMonth, 9), status: "off" },
        { staffId: cleaner, day: addDays(lastMonth, 13), status: "sick" },
        { staffId: cleaner, day: addDays(lastMonth, 14), status: "sick" },
      ],
    }),
  );
  const paidOn = addDays(thisMonth, 2) <= today ? addDays(thisMonth, 2) : today;
  for (const [staffId, base, bonus, notes] of [
    [guard, "42 000", "3 000", "Prime de nuits"],
    [cleaner, "36 000", "", ""],
  ] as const) {
    const { payId } = await savePay(
      manager,
      savePaySchema.parse({
        staffId,
        month: lastMonth.slice(0, 7),
        baseAmount: base,
        bonus,
        deduction: "",
        notes,
      }),
    );
    await payStaff(manager, payStaffSchema.parse({ payId, paidOn, method: "cash" }));
  }
  await recordAdvance(
    manager,
    recordAdvanceSchema.parse({
      staffId: guard,
      paidOn: thisMonth <= today ? thisMonth : today,
      month: today.slice(0, 7),
      amount: "5 000",
      notes: "Avance demandée pour la rentrée scolaire",
    }),
  );
  return { guard };
}

/** An urgent lift breakdown with the supplier, a solved leak, open requests. */
async function seedTickets(
  manager: TenantCtx,
  residenceId: string,
  unitIds: Map<string, string>,
  ids: { lifts: string; guard: string },
) {
  const ticket = async (fields: Omit<z.input<typeof createTicketSchema>, "residenceId">) =>
    (await createTicket(manager, createTicketSchema.parse({ residenceId, ...fields }))).id;
  const lift = await ticket({
    unitId: "",
    reporterName: "Belhadj Rabah",
    title: "Ascenseur bloqué au 3e étage",
    description: "La porte palière ne se referme plus, l'ascenseur est à l'arrêt.",
    category: "elevator",
    priority: "urgent",
  });
  await assignTicket(
    manager,
    assignTicketSchema.parse({ ticketId: lift, staffId: "", supplierId: ids.lifts }),
  );
  await changeTicketStatus(
    manager,
    changeTicketStatusSchema.parse({
      ticketId: lift,
      status: "in_progress",
      comment: "Technicien attendu demain matin.",
    }),
  );
  const leak = await ticket({
    unitId: "",
    reporterName: "",
    title: "Fuite d'eau dans la cage d'escalier",
    description: "Une canalisation fuit entre le 1er et le 2e étage.",
    category: "plumbing",
    priority: "high",
  });
  await assignTicket(
    manager,
    assignTicketSchema.parse({ ticketId: leak, staffId: ids.guard, supplierId: "" }),
  );
  await changeTicketStatus(
    manager,
    changeTicketStatusSchema.parse({
      ticketId: leak,
      status: "resolved",
      comment: "Joint changé.",
    }),
  );
  await ticket({
    unitId: need(unitIds, code(4, 2)),
    reporterName: "Mokrani Djamila",
    title: "Infiltration au plafond de la cuisine",
    description: "Tache d'humidité qui s'étend depuis les dernières pluies.",
    category: "plumbing",
    priority: "normal",
  });
  const parking = await ticket({
    unitId: "",
    reporterName: "Zitouni Nadia",
    title: "Éclairage extérieur hors service",
    description: "",
    category: "electricity",
    priority: "low",
  });
  await commentTicket(
    manager,
    commentTicketSchema.parse({ ticketId: parking, comment: "Ampoules commandées." }),
  );
}

/**
 * Last spring's ordinary assembly, closed with its PV (two thirds missing for the terrace
 * works), and an extraordinary one convened in three weeks.
 */
async function seedAssemblies(
  manager: TenantCtx,
  residenceId: string,
  unitIds: Map<string, string>,
) {
  const today = todayInAlgiers();
  const year = Number(today.slice(0, 4));
  const resolution = (assemblyId: string, title: string, titleAr: string, majority: Majority) =>
    addResolution(
      manager,
      addResolutionSchema.parse({ assemblyId, title, titleAr, description: "", majority }),
    );

  const heldOn = addDays(today, -60);
  const { id: ordinary } = await createAssembly(
    manager,
    createAssemblySchema.parse({
      residenceId,
      kind: "ordinary",
      heldOn,
      startTime: "18:00",
      place: "Salle polyvalente de la résidence",
      notes: "",
    }),
  );
  const agenda = [
    await resolution(
      ordinary,
      `Approbation des comptes de l'exercice ${year - 1}`,
      `المصادقة على حسابات السنة المالية ${year - 1}`,
      "simple",
    ),
    await resolution(
      ordinary,
      `Approbation du budget prévisionnel ${year}`,
      `المصادقة على الميزانية التقديرية ${year}`,
      "simple",
    ),
    await resolution(ordinary, "Renouvellement du gestionnaire pour deux ans", "", "absolute"),
    await resolution(ordinary, "Travaux d'étanchéité de la terrasse", "", "two_thirds"),
  ].map((r) => r.id);
  await conveneAssembly(manager, ordinary);
  // The convocation went out two weeks before the meeting.
  await withTenant(manager, (tx) =>
    tx
      .update(generalAssembly)
      .set({ convenedAt: fromAlgiersDateTime(`${addDays(heldOn, -15)}T10:00`) })
      .where(eq(generalAssembly.id, ordinary)),
  );
  const present = [
    code(0, 1),
    code(0, 2),
    code(1, 1),
    code(1, 2),
    code(2, 1),
    code(2, 2),
    code(3, 1),
    code(3, 2),
    code(4, 1),
  ];
  const represented: [string, string][] = [
    [code(1, 3), "Djebbar Amina"],
    [code(4, 2), "Hadjadj Lamia"],
  ];
  await saveAssemblyAttendance(
    manager,
    saveAssemblyAttendanceSchema.parse({
      assemblyId: ordinary,
      rows: [
        ...present.map((unitCode) => ({
          unitId: need(unitIds, unitCode),
          kind: "present",
          proxyName: "",
        })),
        ...represented.map(([unitCode, proxyName]) => ({
          unitId: need(unitIds, unitCode),
          kind: "represented",
          proxyName,
        })),
      ],
    }),
  );
  const voters = [...present, ...represented.map(([unitCode]) => unitCode)];
  const choiceOf = (position: number, unitCode: string) => {
    if (position === 1 && unitCode === code(2, 2)) return "abstain";
    if (position === 2 && [code(1, 2), code(3, 2)].includes(unitCode)) return "against";
    if (position === 4 && [code(2, 2), code(3, 2)].includes(unitCode)) return "against";
    if (position === 4 && unitCode === code(4, 2)) return "abstain";
    return "for";
  };
  await saveVotes(
    manager,
    saveVotesSchema.parse({
      assemblyId: ordinary,
      votes: agenda.flatMap((resolutionId, index) =>
        voters.map((unitCode) => ({
          resolutionId,
          unitId: need(unitIds, unitCode),
          choice: choiceOf(index + 1, unitCode),
        })),
      ),
    }),
  );
  await closeAssembly(
    manager,
    closeAssemblySchema.parse({
      assemblyId: ordinary,
      chairName: "Hadjadj Lamia",
      secretaryName: "Rachid Ouali",
      endTime: "20:10",
    }),
  );

  const { id: extraordinary } = await createAssembly(
    manager,
    createAssemblySchema.parse({
      residenceId,
      kind: "extraordinary",
      heldOn: addDays(today, 21),
      startTime: "18:30",
      place: "Hall du bloc Y",
      notes: "Devis de vidéosurveillance à présenter.",
    }),
  );
  await resolution(
    extraordinary,
    "Installation de caméras de surveillance",
    "تركيب كاميرات المراقبة",
    "two_thirds",
  );
  await resolution(
    extraordinary,
    "Remplacement de l'interphone",
    "استبدال جهاز الاتصال الداخلي",
    "absolute",
  );
  await conveneAssembly(manager, extraordinary);
  return { extraordinaryOn: addDays(today, 21) };
}

/** The upcoming assembly (pinned), a water cut, a draft and a withdrawn one. */
async function seedAnnouncements(manager: TenantCtx, residenceId: string, assemblyOn: string) {
  const today = todayInAlgiers();
  const announce = async (fields: {
    category: "general" | "works" | "outage" | "meeting" | "safety";
    title: string;
    titleAr?: string;
    body: string;
    bodyAr?: string;
    expiresOn?: string;
    pinned?: boolean;
  }) =>
    (
      await createAnnouncement(
        manager,
        createAnnouncementSchema.parse({
          residenceId,
          titleAr: "",
          bodyAr: "",
          expiresOn: "",
          pinned: false,
          ...fields,
        }),
      )
    ).id;
  const meeting = await announce({
    category: "meeting",
    title: "Assemblée générale extraordinaire",
    titleAr: "جمعية عامة غير عادية",
    body: "Les copropriétaires sont convoqués en assemblée générale extraordinaire dans le hall du bloc Y. Ordre du jour : vidéosurveillance et interphone.",
    bodyAr:
      "يُستدعى الملاك المشتركون إلى جمعية عامة غير عادية في بهو العمارة. جدول الأعمال: المراقبة بالفيديو وجهاز الاتصال الداخلي.",
    expiresOn: assemblyOn,
    pinned: true,
  });
  await publishAnnouncement(manager, meeting);
  const water = await announce({
    category: "outage",
    title: "Coupure d'eau pour nettoyage de la bâche",
    titleAr: "انقطاع الماء لتنظيف الخزان",
    body: "L'eau sera coupée de 9 h à 13 h. Merci de prévoir vos réserves.",
    bodyAr: "سيُقطع الماء من الساعة 9 إلى الساعة 13. يرجى الاحتياط.",
    expiresOn: addDays(today, 3),
  });
  await publishAnnouncement(manager, water);
  await announce({
    category: "works",
    title: "Nettoyage des caves",
    body: "Les caves seront vidées des encombrants : merci de retirer vos affaires avant la date indiquée.",
  });
  const pests = await announce({
    category: "safety",
    title: "Désinsectisation des parties communes",
    body: "Une désinsectisation des parties communes a lieu samedi matin.",
  });
  await publishAnnouncement(manager, pests);
  await archiveAnnouncement(manager, pests);
}

/** Seeds the demo residence; returns its id. */
/**
 * The deadlines El Yasmine keeps: the lift's yearly inspection due within the month (last one a
 * year ago, with remarks), the extinguishers' check overdue, the building insurance renewed in
 * the spring, the water tank cleaned every six months.
 */
async function seedChecks(manager: TenantCtx, residenceId: string, lifts: string) {
  const today = todayInAlgiers();
  const check = async (input: Record<string, string>) =>
    (
      await createCheck(
        manager,
        createCheckSchema.parse({
          residenceId,
          supplierId: "",
          reference: "",
          notes: "",
          ...input,
        }),
      )
    ).id;
  const lift = await check({
    kind: "inspection",
    category: "lift",
    title: "Contrôle périodique de l'ascenseur",
    supplierId: lifts,
    frequencyMonths: "12",
    nextDueOn: addDays(today, -345),
    notes: "Organisme agréé, en présence du prestataire de maintenance.",
  });
  await recordVisit(
    manager,
    recordVisitSchema.parse({
      checkId: lift,
      doneOn: addDays(today, -345),
      supplierId: lifts,
      result: "remarks",
      notes: "Éclairage de cabine à remplacer.",
      cost: "28 000",
      nextDueOn: addDays(today, 20),
    }),
  );
  await check({
    kind: "inspection",
    category: "fire_safety",
    title: "Vérification des extincteurs",
    frequencyMonths: "12",
    nextDueOn: addDays(today, -12),
  });
  await check({
    kind: "insurance",
    category: "building",
    title: "Assurance multirisque immeuble",
    frequencyMonths: "12",
    nextDueOn: addDays(today, 200),
    reference: "CAAR-MRI-2026-1187",
  });
  await check({
    kind: "maintenance",
    category: "water_tank",
    title: "Nettoyage et désinfection de la bâche d'eau",
    frequencyMonths: "6",
    nextDueOn: addDays(today, 95),
  });
}

export async function seedResidences(actors: Actors) {
  const { owner, manager } = actors;
  const { projectId, unitIds } = await seedBuilding(owner);
  const { id: residenceId } = await createResidence(
    manager,
    createResidenceSchema.parse({
      projectId,
      name: DEMO_RESIDENCE,
      address: "Lotissement El Yasmine, lot 7",
      commune: "Chéraga",
      wilaya: "Alger",
      shareBasis: "10000",
      chargeFrequency: "quarterly",
      reserveFund: "5",
      callDueDays: "30",
      notes: "Bloc unique de 14 lots, dont deux locaux commerciaux au rez-de-chaussée.",
    }),
  );
  await distributeSharesByArea(manager, residenceId);
  for (const c of coOwners) {
    await addResident(
      manager,
      addResidentSchema.parse({
        residenceId,
        unitId: need(unitIds, c.unit),
        kind: "co_owner",
        isMain: c.isMain ?? true,
        lastName: c.lastName,
        firstName: c.firstName,
        lastNameAr: c.lastNameAr ?? "",
        firstNameAr: c.firstNameAr ?? "",
        phone: c.phone ?? "",
        whatsappOptIn: c.whatsapp ?? false,
        email: c.email ?? "",
        sinceOn: SINCE,
      }),
    );
  }
  await addResident(
    manager,
    addResidentSchema.parse({
      residenceId,
      unitId: need(unitIds, code(4, 3)),
      kind: "occupant",
      isMain: true,
      lastName: "Benamar",
      firstName: "Anis",
      phone: "0663 27 54 81",
      sinceOn: "2025-09-01",
    }),
  );
  // The flats and the shop sold in 2023 were handed over before the app; the company keeps
  // the other shop (never stock for sale).
  await recordPastDeliveries(
    owner,
    pastDeliveriesSchema.parse({
      projectId,
      unitIds: [...new Set(coOwners.map((c) => need(unitIds, c.unit)))],
      reason: DELIVERED,
    }),
  );
  await blockUnit(
    owner,
    unitStatusReasonSchema.parse({
      unitId: need(unitIds, code(0, 2)),
      reason: "Local commercial conservé par la société",
    }),
  );
  const { categories, budgetId } = await seedCharges(manager, residenceId, unitIds);
  await seedCalls(actors, residenceId, budgetId, unitIds);
  const { lifts } = await seedSuppliers(manager, residenceId, categories);
  await seedChecks(manager, residenceId, lifts);
  const { guard } = await seedStaff(manager, residenceId, categories);
  await seedTickets(manager, residenceId, unitIds, { lifts, guard });
  const { extraordinaryOn } = await seedAssemblies(manager, residenceId, unitIds);
  await seedAnnouncements(manager, residenceId, extraordinaryOn);
  return residenceId;
}
