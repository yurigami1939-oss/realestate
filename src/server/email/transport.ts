import "server-only";

import nodemailer from "nodemailer";

import { env } from "@/env";
import type { EmailMessage } from "@/jobs/queues";

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
});

/** Sends immediately. Request handlers must use `sendEmailLater` (queued, retried) instead. */
export async function sendEmailNow(message: EmailMessage): Promise<void> {
  await transport.sendMail({ from: env.SMTP_FROM, ...message });
}
