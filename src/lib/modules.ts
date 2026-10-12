import type { statement } from "./permissions";

/**
 * The switchable parts of the product (CLAUDE.console.md §5): a plan or an add-on entitles an
 * organization to them, its gérant may switch them off. Everything else is core, always on.
 */
export const modules = [
  "imports",
  "construction",
  "costs",
  "treasury",
  "reports",
  "portal",
  "lead_capture",
  "syndic",
  "rentals",
  "whatsapp",
  "online_payment",
] as const;

export type Module = (typeof modules)[number];

export const isModule = (value: string): value is Module =>
  (modules as readonly string[]).includes(value);

/** Modules that only work with another one on: online payment happens on the portal. */
export const moduleDeps: Readonly<Partial<Record<Module, readonly Module[]>>> = {
  online_payment: ["portal"],
};

/** The modules that use the organization's suppliers (`supplier`, shared). */
export const supplierModules: readonly Module[] = ["syndic", "costs", "construction"];

/**
 * Which module each permission resource belongs to (CLAUDE.console.md §5): `core` is always
 * on; `shared` (the suppliers) needs one of the modules using it. Complete by type; the catalog
 * test checks it at run time too.
 */
export const resourceModule: Record<keyof typeof statement, Module | "core" | "shared"> = {
  organization: "core",
  member: "core",
  invitation: "core",
  team: "core",
  ac: "core",
  audit: "core",
  inventory: "core",
  project: "core",
  unit: "core",
  price: "core",
  lead: "core",
  quotation: "core",
  discount: "core",
  target: "core",
  buyer: "core",
  sale: "core",
  payment: "core",
  milestone: "core",
  commission: "core",
  personal_data: "core",
  subscription: "core",
  residence: "syndic",
  charge: "syndic",
  staff: "syndic",
  ticket: "syndic",
  assembly: "syndic",
  announcement: "syndic",
  visitor: "syndic",
  supplier: "shared",
  portal: "portal",
  construction: "construction",
  handover: "construction",
  lease: "rentals",
  notification: "whatsapp",
  treasury: "treasury",
  cost: "costs",
  report: "reports",
};

/** Whether a module is on; `on` null or absent = no restriction (the seed, jobs, tests). */
export const moduleOn = (on: readonly Module[] | null | undefined, module: Module): boolean =>
  !on || on.includes(module);

/** Whether a permission's resource is reachable with these modules on. */
export function resourceAllowed(resource: string, on: readonly Module[] | null | undefined) {
  if (!on) return true;
  const owner = resourceModule[resource as keyof typeof resourceModule] ?? "core";
  if (owner === "core") return true;
  if (owner === "shared") return supplierModules.some((m) => on.includes(m));
  return on.includes(owner);
}

/**
 * The modules an organization actually has (CLAUDE.console.md §1): entitled by its
 * subscription, not switched off by its gérant, with every prerequisite on.
 */
export function effectiveModules(
  entitled: readonly string[],
  disabled: readonly string[],
): Module[] {
  const on = new Set<Module>(entitled.filter(isModule).filter((m) => !disabled.includes(m)));
  for (let changed = true; changed;) {
    changed = false;
    for (const m of on) {
      if ((moduleDeps[m] ?? []).some((dep) => !on.has(dep))) {
        on.delete(m);
        changed = true;
      }
    }
  }
  return modules.filter((m) => on.has(m));
}

/** The modules that need this one (to switch off first). */
export const dependantsOf = (module: Module): Module[] =>
  modules.filter((m) => (moduleDeps[m] ?? []).includes(module));
