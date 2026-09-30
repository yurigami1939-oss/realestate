/**
 * Every pg-boss queue. Queues are created by `pnpm db:migrate`, before anything can enqueue.
 * Payload types live next to the handler in src/jobs/handlers.
 */
export const queueNames = ["email.send"] as const;

export type QueueName = (typeof queueNames)[number];
