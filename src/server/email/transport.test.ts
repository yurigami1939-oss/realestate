import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ServerEnv } from "@/env";

import { sendEmailNow } from "./transport";

// The demo deployment (CLAUDE.console.md §13): nothing leaves.
vi.mock("@/env", async (original) => {
  const { env } = await original<{ env: ServerEnv }>();
  return { env: { ...env, DEMO_MODE: true } };
});

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

describe("e-mails on the demo deployment", () => {
  it("are dropped, never sent", async () => {
    const subject = `demo ${randomUUID()}`;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const outcome = await sendEmailNow({
      to: "prospect@example.test",
      subject,
      html: "<p>Bonjour</p>",
      text: "Bonjour",
    });
    expect(outcome).toBe("dropped");
    expect(info).toHaveBeenCalledWith(expect.stringContaining(subject));
    info.mockRestore();

    // SMTP is synchronous: a message sent would already be in Mailpit.
    const search = `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`;
    const body = (await (await fetch(search)).json()) as { messages: unknown[] };
    expect(body.messages).toHaveLength(0);
  });
});
