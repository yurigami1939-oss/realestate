import type { QueueOptions } from "pg-boss";

/**
 * Every pg-boss queue with its retry policy. Queues are created or updated by `pnpm db:migrate`,
 * before anything can enqueue. Tenant jobs carry `organizationId` and run inside `withTenant`.
 */
export const queues = {
  "email.send": { retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 120 },
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
};
