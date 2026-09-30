import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";

import { enqueue, stopEnqueue } from "./enqueue";
import { handleSendEmail } from "./handlers/send-email";
import type { JobPayloads } from "./queues";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

async function findMail(subject: string) {
  const url = `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const res = await fetch(url);
    const body = (await res.json()) as { messages: { To: { Address: string }[] }[] };
    if (body.messages.length > 0) return body.messages[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

afterAll(async () => {
  await stopEnqueue();
});

describe("email jobs", () => {
  it("the email.send handler delivers through SMTP", async () => {
    const subject = `test ${randomUUID()}`;
    const job = {
      id: randomUUID(),
      name: "email.send",
      data: { to: "buyer@example.test", subject, html: "<p>Bonjour</p>", text: "Bonjour" },
    } as Job<JobPayloads["email.send"]>;

    await handleSendEmail([job]);

    const mail = await findMail(subject);
    expect(mail?.To[0]?.Address).toBe("buyer@example.test");
  });

  it("enqueue stores a job in the email.send queue", async () => {
    const subject = `queued ${randomUUID()}`;
    const id = await enqueue("email.send", { to: "a@example.test", subject, html: "", text: "" });
    expect(id).toBeTruthy();

    const { rows } = await db.execute<{ name: string; state: string }>(
      sql`select name, state from pgboss.job where id = ${id}`,
    );
    expect(rows[0]).toEqual({ name: "email.send", state: "created" });
  });
});
