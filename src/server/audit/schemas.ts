/** Isomorphic: shared by the audit log page filters and its query. */
import { z } from "zod";

export const AUDIT_PAGE_SIZE = 50;

/** Entity types written by the services and Better Auth hooks (CLAUDE.md §7 Audit). */
export const auditEntityTypes = [
  "organization",
  "member",
  "invitation",
  "unit",
  "price_list",
  "lead",
  "quotation",
  "construction_milestone",
  "reservation",
  "payment",
  "commission",
  "residence",
  "charge_category",
  "budget",
  "charge_period",
  "charge_payment",
  "supplier_invoice",
  "staff_member",
  "general_assembly",
] as const;
export type AuditEntityType = (typeof auditEntityTypes)[number];

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

export const auditListParams = z.object({
  entityType: z.enum(auditEntityTypes).optional().catch(undefined),
  entityId: z.uuid().optional().catch(undefined),
  actorUserId: z.uuid().optional().catch(undefined),
  /** Algiers calendar days, inclusive. */
  from: calendarDate,
  to: calendarDate,
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type AuditListParams = z.output<typeof auditListParams>;
