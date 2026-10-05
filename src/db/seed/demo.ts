/**
 * Demo promoter. Local development and e2e only; the password is a published test value.
 * Inventory, CRM, buyers and payments are added here as their modules land (CLAUDE.md §11).
 */
import type { Role } from "@/lib/permissions";

export const DEMO_PASSWORD = "demo-password-2026";

export type DemoUser = { key: string; name: string; email: string; roles: Role[] };

export const demoUsers = [
  { key: "owner", name: "Karim Benali", email: "gerant@demo.test", roles: ["owner"] },
  {
    key: "salesManager",
    name: "Nadia Messaoudi",
    email: "directrice.commerciale@demo.test",
    roles: ["sales_manager"],
  },
  {
    key: "salesAgent",
    name: "Yacine Belkacem",
    email: "commercial@demo.test",
    roles: ["sales_agent"],
  },
  {
    key: "salesAgent2",
    name: "Lina Saadi",
    email: "commerciale2@demo.test",
    roles: ["sales_agent"],
  },
  { key: "accountant", name: "Samira Hamdi", email: "comptable@demo.test", roles: ["accountant"] },
  { key: "cashier", name: "Amina Haddad", email: "caisse@demo.test", roles: ["cashier"] },
  {
    key: "technicalManager",
    name: "Mourad Bouzid",
    email: "technique@demo.test",
    roles: ["technical_manager"],
  },
  {
    key: "propertyManager",
    name: "Rachid Ouali",
    email: "syndic@demo.test",
    roles: ["property_manager"],
  },
  { key: "resident", name: "Mohamed Cherif", email: "acquereur@demo.test", roles: ["resident"] },
] as const satisfies readonly DemoUser[];

export const demoOrganizations = [
  {
    slug: "el-bahdja-immobilier",
    name: "El Bahdja Immobilier",
    legalName: "SARL El Bahdja Immobilier",
    address: "12, rue Didouche Mourad, Alger-Centre",
    wilaya: "16 - Alger",
    phone: "+213 21 63 45 78",
    rcNumber: "16/00-1234567B19",
    nif: "001916123456789",
    nis: "001916010012345",
    aiNumber: "16012345678",
    /** Every demo user is a member of the main organization. */
    members: "all",
  },
  {
    slug: "jardins-oran",
    name: "Les Jardins d'Oran",
    legalName: "SARL Les Jardins d'Oran",
    address: "Boulevard de la Soummam, Oran",
    wilaya: "31 - Oran",
    phone: "+213 41 33 12 90",
    rcNumber: "31/00-7654321B21",
    nif: "002131765432101",
    nis: "002131010076543",
    aiNumber: "31098765432",
    /** Second SARL of the same gérant: exercises the organization switcher. */
    members: "owner",
  },
] as const;
