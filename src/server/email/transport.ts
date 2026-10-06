import "server-only";

import nodemailer from "nodemailer";

import { env } from "@/env";
import type { EmailMessage } from "@/jobs/queues";
import { getObjectBytes } from "@/server/files/storage";

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
});

/** Sends immediately. Request handlers must use `sendEmailLater` (queued, retried) instead. */
export async function sendEmailNow(message: EmailMessage): Promise<void> {
  const { attachments = [], ...rest } = message;
  const files = [];
  for (const attachment of attachments) {
    files.push({
      filename: attachment.fileName,
      contentType: attachment.contentType,
      content: Buffer.from(await getObjectBytes(attachment.storageKey)),
    });
  }
  await transport.sendMail({ from: env.SMTP_FROM, ...rest, attachments: files });
}
