/**
 * The operator's side of the demo (CLAUDE.console.md §15): the catalog — three plans and four
 * add-ons at **placeholder prices** (the real ones are the operator's to set, §18) — and the
 * demo gérant's client account: both SARLs on Promoteur with every add-on, active, billed
 * yearly, the current period started three months ago (relative to today, like the rest of the
 * seed).
 */
import { eq } from "drizzle-orm";

import { addDays, addMonths, todayInAlgiers } from "@/lib/dates";
import { symmetricEncrypt } from "better-auth/crypto";

import { db } from "@/db/client";
import { auth } from "@/server/auth/auth";
import { OPERATOR_ROLE } from "@/server/auth/schema-options";
import { attachOrganization, openBillingAccount } from "@/server/console/accounts";
import {
  draftInvoice,
  issueInvoice,
  recordConsolePayment,
  saveOperatorProfile,
} from "@/server/console/billing";
import { systemOperator } from "@/server/console/context";
import { createAddon, createPlan } from "@/server/console/plans";
import { addonSchema, openAccountSchema, planSchema } from "@/server/console/schemas";
import { setModuleEnabled } from "@/server/entitlements/switches";
import {
  createBuildingSchema,
  createProjectSchema,
  generateUnitsSchema,
} from "@/server/inventory/schemas";
import { createBuilding, createProject, generateUnits } from "@/server/inventory/service";

import { consoleDb } from "../console-client";
import { withConsoleTenant } from "../console-tenant";
import {
  invoice,
  organization,
  pilotGoal,
  tenantEntitlement,
  twoFactor,
  user,
} from "../schema";

import { DEMO_PASSWORD, demoOperator, pilotPromoter } from "./demo";

const corePlus = ["imports"] as const;
const promoteurModules = [
  ...corePlus,
  "construction",
  "costs",
  "treasury",
  "reports",
  "portal",
  "lead_capture",
] as const;

/** Placeholder prices, HT in dinars (CLAUDE.console.md §18: to be set by the operator). */
const plans = [
  {
    code: "essentiel",
    nameFr: "Essentiel",
    nameAr: "الأساسية",
    yearlyPrice: "400000",
    quarterlyPrice: "120000",
    setupFee: "150000",
    modules: [...corePlus],
    activeUnits: "100",
    organizations: "1",
    storageGb: "20",
    onQuote: false,
  },
  {
    code: "promoteur",
    nameFr: "Promoteur",
    nameAr: "المرقّي",
    yearlyPrice: "900000",
    quarterlyPrice: "270000",
    setupFee: "250000",
    modules: [...promoteurModules],
    activeUnits: "300",
    organizations: "2",
    storageGb: "100",
    onQuote: false,
  },
  {
    code: "groupe",
    nameFr: "Groupe",
    nameAr: "المجموعة",
    yearlyPrice: "0",
    quarterlyPrice: "0",
    setupFee: "0",
    modules: [...promoteurModules],
    activeUnits: "",
    organizations: "",
    storageGb: "",
    onQuote: true,
  },
];

const addons = [
  { code: "syndic", basis: "per_managed_lot", yearlyPrice: "300", quarterlyPrice: "300" },
  { code: "rentals", basis: "flat", yearlyPrice: "120000", quarterlyPrice: "36000" },
  { code: "whatsapp", basis: "flat", yearlyPrice: "60000", quarterlyPrice: "18000" },
  { code: "online_payment", basis: "flat", yearlyPrice: "100000", quarterlyPrice: "30000" },
];

/** Plans and add-ons, before any organization: every organization is entitled at creation. */
export async function seedConsoleCatalog(): Promise<void> {
  await consoleDb.transaction(async (tx) => {
    for (const p of plans) await createPlan(systemOperator, planSchema.parse(p), tx);
    for (const a of addons) await createAddon(systemOperator, addonSchema.parse(a), tx);
  });
  // A placeholder profile (CLAUDE.console.md §15): the operator's real identity, bank and VAT
  // regime are to be set with its accountant (§18).
  await saveOperatorProfile(systemOperator, {
    legalName: "Darna SARL (profil fictif)",
    brand: "Darna",
    legalForm: "SARL",
    address: "Rue fictive, Hydra",
    wilaya: "16 - Alger",
    phone: "+213 23 00 00 00",
    email: "facturation@darna.test",
    rcNumber: "16/00-0000000B26",
    nif: "000016000000000",
    nis: "000016000000000",
    aiNumber: "16000000000",
    bank: "Banque fictive, agence Hydra",
    rib: "000 00000 0000000000 00",
    vatRegime: "vat",
    vatRateBp: 1900,
    paymentTermsDays: 15,
    footerFr: "Profil de démonstration : coordonnées et RIB fictifs.",
    footerAr: "ملف تجريبي: معلومات ورقم حساب وهمية.",
  });
}

/**
 * The demo client's invoices (CLAUDE.console.md §15), once its usage is measured: the current
 * year issued when it started (without the setup fee: a yearly commitment) and paid by transfer
 * ten days later, and a training invoice issued five days ago, still due.
 */
export async function seedDemoBilling(billingAccountId: string): Promise<void> {
  const start = addMonths(todayInAlgiers(), -3);
  const draft = await draftInvoice(systemOperator, billingAccountId);
  const yearly = await issueInvoice(systemOperator, {
    billingAccountId,
    issuedOn: start,
    lines: draft.lines.filter((line) => line.kind !== "setup"),
  });
  const [issued] = await consoleDb
    .select({ total: invoice.totalTtc })
    .from(invoice)
    .where(eq(invoice.id, yearly.invoiceId));
  await recordConsolePayment(systemOperator, {
    invoiceId: yearly.invoiceId,
    paidOn: addDays(start, 10),
    amount: issued?.total ?? 0n,
    method: "bank_transfer",
    reference: "VIR BNA 2026/0417",
  });
  await issueInvoice(systemOperator, {
    billingAccountId,
    issuedOn: addDays(todayInAlgiers(), -5),
    lines: [
      {
        kind: "other",
        addonCode: null,
        labelFr: "Formation de deux nouveaux collaborateurs (une journée)",
        labelAr: "تكوين موظفَين جديدَين (يوم واحد)",
        periodStart: null,
        periodEnd: null,
        quantity: 1,
        unitPrice: 60_000_00n,
      },
    ],
  });
}

/** The demo gérant's client account, opened with its first SARL; returns the account. */
export async function openDemoAccount(organizationId: string): Promise<string> {
  const start = addMonths(todayInAlgiers(), -3);
  const { billingAccountId } = await openBillingAccount(
    systemOperator,
    openAccountSchema.parse({
      legalName: "",
      contactName: "Karim Benali",
      email: "gerant@demo.test",
      organizationIds: [organizationId],
      planCode: "promoteur",
      status: "active",
      program: "standard",
      billingPeriod: "yearly",
      currentPeriodStart: start,
      currentPeriodEnd: addDays(addMonths(start, 12), -1),
      addons: ["syndic", "rentals", "whatsapp", "online_payment"].map((code) => ({ code })),
    }),
  );
  return billingAccountId;
}

/**
 * Another SARL of the same client joins its account (and entitlement); its gérant switched
 * off the residence and rentals modules it does not use.
 */
export async function attachToDemoAccount(
  billingAccountId: string,
  organizationId: string,
  ownerId: string,
): Promise<void> {
  await attachOrganization(systemOperator, { billingAccountId, organizationId });
  const owner = {
    userId: ownerId,
    orgId: organizationId,
    roles: ["owner" as const],
    locale: "fr" as const,
  };
  await setModuleEnabled(owner, { module: "syndic", on: false });
  await setModuleEnabled(owner, { module: "rentals", on: false });
}

/** The small promoter piloting Essentiel: its gérant, its SARL, one project of 12 flats. */
export async function seedPilotPromoter(): Promise<void> {
  const { user } = await auth.api.signUpEmail({
    body: { ...pilotPromoter.user, password: DEMO_PASSWORD },
  });
  const org = await auth.api.createOrganization({
    body: { ...pilotPromoter.organization, userId: user.id },
  });
  if (!org) throw new Error("seed: pilot organization not created");
  const today = todayInAlgiers();
  const { subscriptionId } = await openBillingAccount(
    systemOperator,
    openAccountSchema.parse({
      legalName: "",
      contactName: pilotPromoter.user.name,
      email: pilotPromoter.user.email,
      organizationIds: [org.id],
      planCode: "essentiel",
      status: "pilot",
      program: "standard",
      billingPeriod: "yearly",
      pilotEndsOn: addDays(today, 5),
      addons: [],
    }),
  );
  // The goals agreed for the pilot (CLAUDE.console.md §2), one already reached.
  await consoleDb.insert(pilotGoal).values([
    {
      subscriptionId,
      position: 1,
      label: "Importer les lots de la Résidence Tafna",
      doneOn: today,
    },
    { subscriptionId, position: 2, label: "Émettre les reçus du mois depuis l'application" },
  ]);
  const owner = {
    userId: user.id,
    orgId: org.id,
    roles: ["owner" as const],
    locale: "fr" as const,
  };
  const project = await createProject(
    owner,
    createProjectSchema.parse({
      code: "TAFN",
      name: "Résidence Tafna",
      status: "under_construction",
      address: "Route de Mansourah",
      wilaya: "13 - Tlemcen",
      commune: "Tlemcen",
      plannedDeliveryOn: addMonths(today, 18),
      description: "Un bloc R+4 de douze appartements.",
    }),
  );
  if (!project) throw new Error("seed: pilot project not created");
  const building = await createBuilding(
    owner,
    createBuildingSchema.parse({
      projectId: project.id,
      code: "A",
      name: "Bloc A",
      lowestFloor: "0",
      topFloor: "4",
    }),
  );
  await generateUnits(
    owner,
    generateUnitsSchema.parse({
      buildingId: building.id,
      fromFloor: "1",
      toFloor: "4",
      unitsPerFloor: "3",
      type: "apartment",
      typology: "F3",
      livingArea: "92",
    }),
  );
}

/** Fail closed (CLAUDE.console.md §3): the seed refuses to finish with an organization unentitled. */
export async function assertEveryOrganizationEntitled(): Promise<void> {
  const organizations = await consoleDb
    .select({ id: organization.id, name: organization.name })
    .from(organization);
  for (const org of organizations) {
    const [row] = await withConsoleTenant(org.id, (tx) =>
      tx
        .select({ status: tenantEntitlement.status })
        .from(tenantEntitlement)
        .where(eq(tenantEntitlement.organizationId, org.id)),
    );
    if (!row) throw new Error(`seed: organization ${org.name} has no entitlement`);
  }
}

/**
 * The console's local operator (CLAUDE.console.md §15): an account with role `operator`, its
 * two-factor authentication on with a fixed secret (enabled through Better Auth, then pinned) so
 * a local authenticator app or the tests compute its codes. Never on the demo deployment.
 */
export async function seedOperator(): Promise<void> {
  const { user: created } = await auth.api.signUpEmail({
    body: { name: demoOperator.name, email: demoOperator.email, password: DEMO_PASSWORD },
  });
  const { headers } = await auth.api.signInEmail({
    body: { email: demoOperator.email, password: DEMO_PASSWORD },
    returnHeaders: true,
  });
  const cookie = headers.get("set-cookie")?.split(";")[0] ?? "";
  await auth.api.enableTwoFactor({
    body: { password: DEMO_PASSWORD },
    headers: new Headers({ cookie }),
  });
  const context = await auth.$context;
  await db
    .update(twoFactor)
    .set({
      secret: await symmetricEncrypt({ key: context.secretConfig, data: demoOperator.totpSecret }),
      verified: true,
    })
    .where(eq(twoFactor.userId, created.id));
  await db
    .update(user)
    .set({ role: OPERATOR_ROLE, twoFactorEnabled: true })
    .where(eq(user.id, created.id));
}
