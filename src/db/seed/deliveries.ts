/**
 * Demo deliveries (module 4): « Résidence Les Amandiers », a building finished this month whose
 * « Remise des clés » milestone is validated. Five units are sold (VSP signed): one delivered with
 * its reserves lifted and closed, one delivered with reserves still open (one late), one with an
 * appointment in two days, and two to schedule — one not fully paid. The handovers make the
 * buyers co-owners of the residence set up on the project. Dated relative to today (Algiers);
 * the PDFs render when `pnpm worker` runs.
 */
import { addDays, todayInAlgiers } from "@/lib/dates";
import { type Centimes, toDecimalString } from "@/lib/money";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import {
  addPunchItemSchema,
  closeReservesSchema,
  liftPunchItemSchema,
  scheduleHandoverSchema,
  signHandoverSchema,
} from "@/server/handovers/schemas";
import {
  addPunchItem,
  closeReserves,
  liftPunchItem,
  scheduleHandover,
  signHandover,
} from "@/server/handovers/service";
import {
  createBuildingSchema,
  createProjectSchema,
  createUnitSchema,
  updateUnitPriceSchema,
} from "@/server/inventory/schemas";
import {
  createBuilding,
  createProject,
  createUnit,
  updateUnitPrice,
} from "@/server/inventory/service";
import { validateMilestoneSchema } from "@/server/payment-calls/schemas";
import { issueMilestonePaymentCalls, validateMilestone } from "@/server/payment-calls/service";
import { getProjectPaymentSetup } from "@/server/payment-plans/queries";
import { createPaymentPlanSchema, saveMilestonesSchema } from "@/server/payment-plans/schemas";
import { createPaymentPlan, saveMilestones } from "@/server/payment-plans/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { createResidenceSchema } from "@/server/residences/schemas";
import { createResidence, distributeSharesByArea } from "@/server/residences/service";
import {
  createReservation,
  recordSale,
  updateReservationContract,
} from "@/server/sales/reservations";
import { getSale } from "@/server/sales/sale-queries";
import {
  createReservationSchema,
  recordSaleSchema,
  reservationContractSchema,
} from "@/server/sales/schemas";

export const DELIVERIES_PROJECT = "Résidence Les Amandiers";

type Actors = {
  owner: TenantCtx;
  salesManager: TenantCtx;
  agent: TenantCtx;
  cashier: TenantCtx;
  technical: TenantCtx;
  propertyManager: TenantCtx;
};

const asInput = (amount: Centimes) => toDecimalString(amount).replace(".", ",");

/** Price per m² of the building, in DA. */
const PER_SQM = 140_000;

/** Three flats per floor, ground floor included. */
const flats = [0, 1, 2, 3].flatMap((floor) => [
  { code: `D-0${floor}-01`, floor, typology: "F3" as const, area: "85.40" },
  { code: `D-0${floor}-02`, floor, typology: "F4" as const, area: "108.20" },
  { code: `D-0${floor}-03`, floor, typology: "F3" as const, area: "86.10" },
]);

async function seedBuilding({ owner, salesManager }: Actors) {
  const today = todayInAlgiers();
  const { id: projectId } = await createProject(
    owner,
    createProjectSchema.parse({
      code: "AMND",
      name: DELIVERIES_PROJECT,
      status: "under_construction",
      address: "Cité des Amandiers, lot 12",
      wilaya: "Alger",
      commune: "Draria",
      buildingPermitNumber: "PC 16/2023/0418",
      buildingPermitDate: "2023-11-20",
      launchedOn: "2024-02-01",
      plannedDeliveryOn: addDays(today, 10),
      description: "Bloc unique de douze logements, livré ce mois-ci.",
    }),
  );
  const { id: buildingId } = await createBuilding(
    owner,
    createBuildingSchema.parse({
      projectId,
      code: "D",
      name: "Bloc D",
      lowestFloor: "0",
      topFloor: "3",
    }),
  );
  const units = new Map<string, string>();
  for (const flat of flats) {
    const { id } = await createUnit(
      salesManager,
      createUnitSchema.parse({
        buildingId,
        code: flat.code,
        floor: String(flat.floor),
        type: "apartment",
        typology: flat.typology,
        isDuplex: false,
        livingArea: flat.area.replace(".", ","),
        orientations: [],
      }),
    );
    const price = BigInt(Math.round((Number(flat.area) * PER_SQM) / 1000) * 1000) * 100n;
    await updateUnitPrice(
      salesManager,
      updateUnitPriceSchema.parse({
        unitId: id,
        price: asInput(price),
        reason: "Grille de lancement",
      }),
    );
    units.set(flat.code, id);
  }
  return { projectId, units };
}

/** Milestones (all reached, the handover one five days ago) and a « 90 % + 10 % » plan. */
async function seedPlan({ salesManager }: Actors, projectId: string) {
  const today = todayInAlgiers();
  const milestones = [
    { name: "Achèvement des fondations", stage: "foundations", plannedOn: "2024-09-30" },
    { name: "Achèvement du gros œuvre", stage: "structure", plannedOn: addDays(today, -200) },
    { name: "Achèvement des travaux", stage: "completion", plannedOn: addDays(today, -30) },
    { name: "Remise des clés", stage: "handover", plannedOn: addDays(today, -5) },
  ];
  await saveMilestones(
    salesManager,
    saveMilestonesSchema.parse({
      projectId,
      milestones: milestones.map((m) => ({ id: "", ...m })),
    }),
  );
  const setup = await getProjectPaymentSetup(salesManager, projectId);
  const id = (name: string) => {
    const found = setup.milestones.find((m) => m.name === name);
    if (!found) throw new Error(`seed: milestone ${name} missing`);
    return found.id;
  };
  const { id: planId } = await createPaymentPlan(
    salesManager,
    createPaymentPlanSchema.parse({
      projectId,
      name: "Paiement à la livraison",
      isDefault: true,
      notes: "Bâtiment achevé : 90 % à la signature, le solde à la remise des clés.",
      steps: [
        { label: "Signature", share: "90", trigger: "signing", months: "", milestoneId: "" },
        {
          label: "Remise des clés",
          share: "10",
          trigger: "milestone",
          months: "",
          milestoneId: id("Remise des clés"),
        },
      ],
    }),
  );
  return {
    planId,
    validate: async (name: string, daysAgo: number) =>
      validateMilestone(
        salesManager,
        validateMilestoneSchema.parse({
          milestoneId: id(name),
          validatedOn: addDays(today, -daysAgo),
        }),
      ),
    handoverMilestoneId: id("Remise des clés"),
  };
}

type BuyerSpec = {
  lastName: string;
  firstName: string;
  lastNameAr: string;
  firstNameAr: string;
  phone: string;
  email?: string;
};

type SaleSpec = {
  unit: string;
  buyers: BuyerSpec[];
  reservedDaysAgo: number;
  signedDaysAgo: number;
  method: "cash" | "bank_transfer";
  /** Day the balance (10 %) was paid, after its payment call; null = still due. */
  balancePaidDaysAgo: number | null;
};

const sales: SaleSpec[] = [
  {
    unit: "D-01-01",
    buyers: [
      {
        lastName: "Benyahia",
        firstName: "Mourad",
        lastNameAr: "بن يحيى",
        firstNameAr: "مراد",
        phone: "0550 21 43 65",
      },
      {
        lastName: "Benyahia",
        firstName: "Sihem",
        lastNameAr: "بن يحيى",
        firstNameAr: "سهام",
        phone: "0661 21 43 66",
      },
    ],
    reservedDaysAgo: 480,
    signedDaysAgo: 460,
    method: "bank_transfer",
    balancePaidDaysAgo: 4,
  },
  {
    unit: "D-01-02",
    buyers: [
      {
        lastName: "Saidi",
        firstName: "Amel",
        lastNameAr: "سعيدي",
        firstNameAr: "أمال",
        phone: "0770 58 12 90",
        email: "a.saidi@example.test",
      },
    ],
    reservedDaysAgo: 470,
    signedDaysAgo: 455,
    method: "bank_transfer",
    balancePaidDaysAgo: 4,
  },
  {
    unit: "D-02-01",
    buyers: [
      {
        lastName: "Rahmani",
        firstName: "Yacine",
        lastNameAr: "رحماني",
        firstNameAr: "ياسين",
        phone: "0551 74 30 18",
      },
    ],
    reservedDaysAgo: 465,
    signedDaysAgo: 450,
    method: "cash",
    balancePaidDaysAgo: 3,
  },
  {
    unit: "D-02-02",
    buyers: [
      {
        lastName: "Ferhat",
        firstName: "Karim",
        lastNameAr: "فرحات",
        firstNameAr: "كريم",
        phone: "0662 09 81 57",
      },
    ],
    reservedDaysAgo: 440,
    signedDaysAgo: 430,
    method: "bank_transfer",
    balancePaidDaysAgo: null,
  },
  {
    unit: "D-03-01",
    buyers: [
      {
        lastName: "Mansouri",
        firstName: "Leila",
        lastNameAr: "منصوري",
        firstNameAr: "ليلى",
        phone: "0773 44 62 05",
      },
    ],
    reservedDaysAgo: 420,
    signedDaysAgo: 400,
    method: "bank_transfer",
    balancePaidDaysAgo: 2,
  },
];

/** Five sales: 90 % paid at signing, the VSP signed, then the balance after the call. */
async function seedSales(actors: Actors, units: Map<string, string>, planId: string) {
  const { agent, salesManager, cashier } = actors;
  const today = todayInAlgiers();
  const saleIds = new Map<string, string>();
  for (const spec of sales) {
    const buyerIds: string[] = [];
    for (const b of spec.buyers) {
      const { id } = await createBuyer(
        agent,
        createBuyerSchema.parse({
          lastName: b.lastName,
          firstName: b.firstName,
          lastNameAr: b.lastNameAr,
          firstNameAr: b.firstNameAr,
          phone: b.phone,
          email: b.email ?? "",
          wilaya: "Alger",
          leadId: "",
        }),
      );
      buyerIds.push(id);
    }
    const unitId = units.get(spec.unit);
    if (!unitId) throw new Error(`seed: unit ${spec.unit} missing`);
    const { id } = await createReservation(
      agent,
      createReservationSchema.parse({
        unitId,
        buyerIds,
        paymentPlanId: planId,
        discount: "",
        reservedOn: addDays(today, -spec.reservedDaysAgo),
        notary: "Maître Ouali Rym",
        reference: "",
        notes: "",
      }),
    );
    const sale = await getSale(salesManager, id);
    const signing = sale?.installments[0]?.amount;
    if (!signing) throw new Error("seed: schedule missing");
    const payer = spec.buyers[0];
    await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: id,
        amount: asInput(signing),
        method: spec.method,
        paidOn: addDays(today, -spec.reservedDaysAgo),
        reference: spec.method === "cash" ? "" : "VIR-2024-3317",
        payerName: payer ? `${payer.firstName} ${payer.lastName}` : "",
      }),
    );
    await recordSale(
      salesManager,
      recordSaleSchema.parse({
        reservationId: id,
        signedOn: addDays(today, -spec.signedDaysAgo),
        notary: "Maître Ouali Rym",
        reference: `Rép. ${spec.unit}`,
      }),
    );
    // The contracts promised the keys three weeks ago; one FGCMPI certificate is still missing.
    const guaranteed = spec.unit !== "D-03-01";
    await updateReservationContract(
      salesManager,
      reservationContractSchema.parse({
        reservationId: id,
        notary: "Maître Ouali Rym",
        reference: "",
        deliveryDueOn: addDays(today, -21),
        guaranteeNumber: guaranteed ? `FGCMPI/GAR/${spec.unit}` : "",
        guaranteeIssuedOn: guaranteed ? addDays(today, -spec.signedDaysAgo) : "",
      }),
    );
    saleIds.set(spec.unit, id);
  }
  return saleIds;
}

/** The balance of the sales whose buyers paid after the payment call. */
async function payBalances({ cashier, salesManager }: Actors, saleIds: Map<string, string>) {
  const today = todayInAlgiers();
  for (const spec of sales) {
    const id = saleIds.get(spec.unit);
    if (!id || spec.balancePaidDaysAgo === null) continue;
    const sale = await getSale(salesManager, id);
    if (!sale) throw new Error("seed: sale missing");
    const payer = spec.buyers[0];
    await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: id,
        amount: asInput(sale.statement.remaining),
        method: "bank_transfer",
        paidOn: addDays(today, -spec.balancePaidDaysAgo),
        reference: "VIR-SOLDE",
        payerName: payer ? `${payer.firstName} ${payer.lastName}` : "",
      }),
    );
  }
}

/** The responsable technique's handovers: closed, with open reserves, and planned. */
async function seedHandovers({ technical }: Actors, saleIds: Map<string, string>) {
  const today = todayInAlgiers();
  const sale = (unit: string) => {
    const id = saleIds.get(unit);
    if (!id) throw new Error(`seed: sale ${unit} missing`);
    return id;
  };
  const plan = async (unit: string, daysAgo: number, time: string) =>
    (
      await scheduleHandover(
        technical,
        scheduleHandoverSchema.parse({
          reservationId: sale(unit),
          scheduledAt: `${addDays(today, -daysAgo)}T${time}`,
          notes: "Apporter la pièce d'identité et la copie de l'acte.",
        }),
      )
    ).id;
  const reserve = async (
    handoverId: string,
    location: string,
    description: string,
    trade: "plumbing" | "joinery" | "painting" | "electrical",
    dueInDays: number | null,
  ) =>
    (
      await addPunchItem(
        technical,
        addPunchItemSchema.parse({
          handoverId,
          location,
          description,
          trade,
          dueOn: dueInDays === null ? "" : addDays(today, dueInDays),
        }),
      )
    ).id;
  const sign = (handoverId: string, daysAgo: number, receivedBy: string, meters: string[]) =>
    signHandover(
      technical,
      signHandoverSchema.parse({
        handoverId,
        signedOn: addDays(today, -daysAgo),
        receivedBy,
        keysCount: "3",
        electricityMeter: meters[0] ?? "",
        gasMeter: meters[1] ?? "",
        waterMeter: meters[2] ?? "",
        observations: "",
      }),
    );
  const lift = (punchItemId: string, daysAgo: number, note: string) =>
    liftPunchItem(
      technical,
      liftPunchItemSchema.parse({ punchItemId, liftedOn: addDays(today, -daysAgo), note }),
    );

  // D-01-02: delivered three days ago, both reserves lifted, the PV de levée signed yesterday.
  const saidi = await plan("D-01-02", 3, "10:00");
  const tub = await reserve(
    saidi,
    "Salle de bain",
    "Joint de la baignoire à refaire",
    "plumbing",
    10,
  );
  const window = await reserve(saidi, "Chambre 2", "Porte-fenêtre qui frotte", "joinery", 10);
  await sign(saidi, 3, "Amel Saidi", ["004512", "001387", "0921"]);
  await lift(tub, 2, "Joint silicone refait.");
  await lift(window, 1, "Ouvrant rabotté et réglé.");
  await closeReserves(
    technical,
    closeReservesSchema.parse({ handoverId: saidi, closedOn: addDays(today, -1) }),
  );

  // D-01-01: delivered two days ago; one reserve lifted, one late, one due later.
  const benyahia = await plan("D-01-01", 2, "09:30");
  const socket = await reserve(
    benyahia,
    "Cuisine",
    "Prise électrique sans courant",
    "electrical",
    3,
  );
  await reserve(benyahia, "Séjour", "Fissure d'enduit au plafond", "painting", -1);
  await reserve(benyahia, "Balcon", "Garde-corps à resserrer", "joinery", 12);
  await sign(benyahia, 2, "Mourad Benyahia", ["004498", "001402", "0915"]);
  await lift(socket, 1, "Disjoncteur du circuit remplacé.");

  // D-02-01: appointment in two days; a reserve noted at the pre-delivery inspection.
  const rahmani = await plan("D-02-01", -2, "10:00");
  await reserve(rahmani, "Hall d'entrée", "Peinture du plafond à reprendre", "painting", 7);
}

export async function seedDeliveries(actors: Actors) {
  const { projectId, units } = await seedBuilding(actors);
  const { planId, validate, handoverMilestoneId } = await seedPlan(actors, projectId);
  const saleIds = await seedSales(actors, units, planId);

  // The works went as planned; the « Remise des clés » milestone calls the balance.
  await validate("Achèvement des fondations", 420);
  await validate("Achèvement du gros œuvre", 190);
  await validate("Achèvement des travaux", 25);
  await validate("Remise des clés", 5);
  await issueMilestonePaymentCalls(actors.salesManager.orgId, handoverMilestoneId);
  await payBalances(actors, saleIds);

  // The promoter's property service takes the residence over as the keys are handed.
  const { id: residenceId } = await createResidence(
    actors.propertyManager,
    createResidenceSchema.parse({
      projectId,
      name: DELIVERIES_PROJECT,
      address: "Cité des Amandiers, lot 12",
      commune: "Draria",
      wilaya: "Alger",
      shareBasis: "10000",
      chargeFrequency: "quarterly",
      reserveFund: "5",
      callDueDays: "30",
      notes:
        "Mise en place à la livraison ; les copropriétaires s'inscrivent à la remise des clés.",
    }),
  );
  await distributeSharesByArea(actors.propertyManager, residenceId);
  await seedHandovers(actors, saleIds);
  return { projectId };
}
