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
