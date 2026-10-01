import type { QueueOptions } from "pg-boss";

/**
 * Every pg-boss queue with its retry policy. Queues are created or updated by `pnpm db:migrate`,
 * before anything can enqueue. Tenant jobs carry `organizationId` and run inside `withTenant`.
 */
export const queues = {
  "email.send": { retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 120 },
  /** Releases a unit when its option expires (scheduled at placement, idempotent). */
  "option.expire": { retryLimit: 5, retryDelay: 60, retryBackoff: true, expireInSeconds: 120 },
  /** Renders an issued quotation's PDF and stores it (idempotent). */
  "pdf.quotation": { retryLimit: 3, retryDelay: 15, retryBackoff: true, expireInSeconds: 180 },
} as const satisfies Record<string, QueueOptions>;

export type QueueName = keyof typeof queues;

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
  "pdf.quotation": { organizationId: string; quotationId: string };
  "option.expire": { organizationId: string; optionId: string };
};
