import "server-only";

import { randomBytes } from "node:crypto";

/**
 * Local stand-in of an SMS gateway (`/api/dev/sms/*`, DEV_GATEWAYS only): accepts messages in
 * the gateway protocol (`POST /messages`, src/server/sms/gateway.ts) and keeps the last ones in
 * memory (`GET /messages`). A number ending in 0000 is refused, to see a failure.
 */

type Delivered = { id: string; from: string; to: string; text: string; at: string };

const globalStore = globalThis as unknown as { smsStandIn?: Delivered[] };
const delivered = (globalStore.smsStandIn ??= []);

const error = (status: number, message: string) => Response.json({ error: message }, { status });

async function send(request: Request): Promise<Response> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (token === "") return error(401, "Missing API key");
  let body: { from?: unknown; to?: unknown; text?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, "Invalid JSON");
  }
  const to = typeof body.to === "string" ? body.to : "";
  const text = typeof body.text === "string" ? body.text : "";
  const from = typeof body.from === "string" ? body.from : "";
  if (!/^\+[1-9]\d{7,14}$/.test(to) || text === "" || from === "") {
    return error(400, "Invalid message");
  }
  if (to.endsWith("0000")) return error(422, "Numéro injoignable");
  const message = {
    id: `sms-${randomBytes(8).toString("hex")}`,
    from,
    to,
    text,
    at: new Date().toISOString(),
  };
  delivered.unshift(message);
  delivered.splice(200);
  return Response.json({ id: message.id });
}

export async function handleSmsStandIn(request: Request, path: string): Promise<Response> {
  if (path === "messages" && request.method === "POST") return send(request);
  if (path === "messages" && request.method === "GET") return Response.json({ data: delivered });
  return error(404, "Unknown path");
}
