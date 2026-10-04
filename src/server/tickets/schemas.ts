/** Isomorphic: shared by the ticket forms and their actions. */
import { z } from "zod";

import { ticketCategories, ticketPriorities, ticketStatuses } from "@/lib/tickets";
import { optionalText, requiredText } from "@/lib/zod";

/** "" → null for optional ids coming from selects. */
const optionalId = () => z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v));

export const createTicketSchema = z.object({
  residenceId: z.uuid(),
  /** Empty: common areas. */
  unitId: optionalId(),
  reporterName: optionalText(120),
  title: requiredText(160),
  description: optionalText(4000),
  category: z.enum(ticketCategories),
  priority: z.enum(ticketPriorities),
});

export const changeTicketStatusSchema = z.object({
  ticketId: z.uuid(),
  status: z.enum(ticketStatuses),
  comment: optionalText(2000),
});

/** Assign to an agent of the residence or a supplier; both empty = unassigned. */
export const assignTicketSchema = z
  .object({ ticketId: z.uuid(), staffId: optionalId(), supplierId: optionalId() })
  .refine((v) => v.staffId === null || v.supplierId === null, {
    path: ["supplierId"],
    message: "tickets.errors.oneAssignee",
  });

export const commentTicketSchema = z.object({
  ticketId: z.uuid(),
  comment: requiredText(2000),
});
