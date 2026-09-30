import "server-only";

import { enqueue } from "@/jobs/enqueue";
import type { EmailMessage } from "@/jobs/queues";

/** Queues an email for the worker (retried with backoff if SMTP is down). */
export async function sendEmailLater(message: EmailMessage): Promise<void> {
  await enqueue("email.send", message);
}
