/** Isomorphic: shared by CRM forms and actions. Inputs are form strings. */
import { z } from "zod";

import {
  financingModes,
  followUpChannels,
  leadSources,
  leadStages,
  lostReasons,
  visitStatuses,
} from "@/lib/crm";
import { typologies } from "@/lib/inventory";
import {
  dateTimeText,
  intText,
  optionalEmailText,
  optionalEnum,
  optionalMoneyText,
  optionalPhoneText,
  optionalText,
  phoneText,
  requiredText,
} from "@/lib/zod";

/** Optional reference from a select: "" or missing → null. */
const optionalId = () =>
  z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null));

// ── Leads ───────────────────────────────────────────────────────────────────

export const leadFields = z.object({
  fullName: requiredText(120),
  phone: phoneText(),
  phone2: optionalPhoneText(),
  email: optionalEmailText(),
  city: optionalText(80),
  source: z.enum(leadSources),
  sourceDetail: optionalText(120),
  projectId: optionalId(),
  typologies: z.array(z.enum(typologies)).max(typologies.length),
  budget: optionalMoneyText(),
  financing: optionalEnum(financingModes),
  notes: optionalText(2000),
});

/** `assignedTo` is only honoured for managers; a commercial's lead is always theirs. */
export const createLeadSchema = leadFields.extend({ assignedTo: optionalId() });
export const updateLeadSchema = leadFields.extend({ leadId: z.uuid() });
export const leadIdSchema = z.object({ leadId: z.uuid() });

export const changeLeadStageSchema = z
  .object({
    leadId: z.uuid(),
    stage: z.enum(leadStages),
    lostReason: optionalEnum(lostReasons),
    lostNote: optionalText(500),
  })
  .refine((v) => v.stage !== "lost" || v.lostReason !== null, {
    path: ["lostReason"],
    message: "validation.required",
  });

export const assignLeadSchema = z.object({ leadId: z.uuid(), assignedTo: optionalId() });

export const addLeadNoteSchema = z.object({ leadId: z.uuid(), note: requiredText(2000) });

export const mergeLeadsSchema = z
  .object({ targetId: z.uuid(), sourceId: z.uuid() })
  .refine((v) => v.targetId !== v.sourceId, {
    path: ["sourceId"],
    message: "crm.errors.mergeSelf",
  });

// ── Visits ──────────────────────────────────────────────────────────────────

export const scheduleVisitSchema = z.object({
  leadId: z.uuid(),
  scheduledAt: dateTimeText(),
  projectId: optionalId(),
  unitId: optionalId(),
  agentUserId: optionalId(),
  notes: optionalText(1000),
});

/** Record what happened: done, cancelled or no-show (planned again = reschedule). */
export const updateVisitSchema = z.object({
  visitId: z.uuid(),
  status: z.enum(visitStatuses),
  scheduledAt: dateTimeText(),
  outcome: optionalText(2000),
});

// ── Follow-ups ──────────────────────────────────────────────────────────────

export const createFollowUpSchema = z.object({
  leadId: z.uuid(),
  dueAt: dateTimeText(),
  channel: z.enum(followUpChannels),
  note: optionalText(1000),
  assignedTo: optionalId(),
});

export const completeFollowUpSchema = z.object({
  followUpId: z.uuid(),
  outcome: optionalText(1000),
});

// ── Lists (search params) ───────────────────────────────────────────────────

export const leadListParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  stage: z.enum(leadStages).optional().catch(undefined),
  source: z.enum(leadSources).optional().catch(undefined),
  /** A user id, or "none" for unassigned leads (managers only). */
  assignee: z
    .union([z.uuid(), z.literal("none")])
    .optional()
    .catch(undefined),
  duplicates: z.literal("1").optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type LeadListParams = z.output<typeof leadListParams>;

export const LEADS_PAGE_SIZE = 25;

// ── Targets ─────────────────────────────────────────────────────────────────

/** "YYYY-MM" (Algiers calendar month). */
export const monthText = () => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "validation.date");

export const saveTargetsSchema = z.object({
  month: monthText(),
  targets: z
    .array(
      z.object({
        userId: z.uuid(),
        visits: intText(0, 1000),
        quotations: intText(0, 1000),
        reservations: intText(0, 1000),
        sales: intText(0, 1000),
      }),
    )
    .max(200),
});
