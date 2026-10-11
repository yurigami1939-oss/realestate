/**
 * Visitor management of a residence (CLAUDE.md §7 Residence charges, visitors): visitors
 * announced by residents from the portal with a code for the gate, and the register of arrivals.
 */
export const visitorStatuses = ["expected", "arrived", "cancelled"] as const;
export type VisitorStatus = (typeof visitorStatuses)[number];

/** How far ahead a visitor is announced, and how many one account announces for a day. */
export const VISITOR_DAYS_AHEAD = 30;
export const VISITORS_PER_DAY = 10;

/** The code's alphabet: no 0/O, 1/I/L to misread at the gate. */
export const PASS_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const PASS_CODE_LENGTH = 4;
