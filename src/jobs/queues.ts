import type { QueueOptions } from "pg-boss";

/**
 * Every pg-boss queue with its retry policy. Queues are created or updated by `pnpm db:migrate`,
 * before anything can enqueue. Tenant jobs carry `organizationId` and run inside `withTenant`.
 */
export const queues = {
  "email.send": { retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 120 },
  /** Releases a unit when its option expires (scheduled at placement, idempotent). */
  "option.expire": { retryLimit: 5, retryDelay: 60, retryBackoff: true, expireInSeconds: 120 },
  /** Renders an issued document's PDF once and stores it (idempotent per kind and id). */
  "pdf.document": { retryLimit: 3, retryDelay: 15, retryBackoff: true, expireInSeconds: 180 },
  /** Issues the payment calls of a validated milestone (idempotent per installment). */
  "payment_call.issue": {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
  },
  /** Cron (08:00 Algiers): fans out one overdue digest per organization. */
  "reminders.daily": { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 300 },
  /** Overdue digest of one organization, e-mailed to its cashiers and sales managers. */
  "reminders.digest": { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 300 },
} as const satisfies Record<string, QueueOptions>;

/** Recurring jobs, installed by `pnpm db:migrate` (pg-boss cron, Algiers time). */
export const schedules = [
  { queue: "reminders.daily", cron: "0 8 * * *", tz: "Africa/Algiers" },
] as const satisfies readonly { queue: QueueName; cron: string; tz: string }[];

export type QueueName = keyof typeof queues;

/** Documents rendered by `pdf.document` (src/server/documents/render.ts). */
export const pdfDocumentKinds = [
  "quotation",
  "reservation_sheet",
  "receipt",
  "payment_call",
  "reminder_letter",
  "charge_call",
  "charge_receipt",
] as const;
export type PdfDocumentKind = (typeof pdfDocumentKinds)[number];

export const queueNames = Object.keys(queues) as QueueName[];

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/** Payload of each queue. */
export type JobPayloads = {
  "email.send": EmailMessage;
  "pdf.document": { organizationId: string; kind: PdfDocumentKind; id: string };
  "option.expire": { organizationId: string; optionId: string };
  "payment_call.issue": { organizationId: string; milestoneId: string };
  "reminders.daily": Record<string, never>;
  /** `date`: the Algiers day of the digest (one per organization and day). */
  "reminders.digest": { organizationId: string; date: string };
};
