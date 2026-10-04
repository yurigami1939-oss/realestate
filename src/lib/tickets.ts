/**
 * Residence tickets (réclamations, module 6): vocabulary and status workflow. Isomorphic:
 * shared by the schema, the forms and the services.
 */

export const ticketCategories = [
  "plumbing",
  "electricity",
  "elevator",
  "cleaning",
  "security",
  "common_areas",
  "other",
] as const;
export type TicketCategory = (typeof ticketCategories)[number];

export const ticketPriorities = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof ticketPriorities)[number];

export const ticketStatuses = ["open", "in_progress", "resolved", "closed", "cancelled"] as const;
export type TicketStatus = (typeof ticketStatuses)[number];

/** Allowed status changes; closed and cancelled tickets are final. */
export const ticketTransitions: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["in_progress", "resolved", "cancelled"],
  in_progress: ["open", "resolved", "cancelled"],
  resolved: ["in_progress", "closed"],
  closed: [],
  cancelled: [],
};

/** Tickets still being handled. */
export const activeTicketStatuses: readonly TicketStatus[] = ["open", "in_progress"];

export const ticketEventKinds = ["created", "status", "assigned", "comment"] as const;
export type TicketEventKind = (typeof ticketEventKinds)[number];
