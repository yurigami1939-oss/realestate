import "server-only";

import { randomBytes } from "node:crypto";

/**
 * Local stand-in of the WhatsApp Cloud API (`/api/dev/whatsapp/*`, DEV_GATEWAYS only): accepts
 * template messages like Meta (`POST /{phone-number-id}/messages`) and keeps the last ones in
 * memory (`GET /messages`). A recipient ending in 0000 is undeliverable, to see a failure.
 */

type Delivered = {
  wamid: string;
  phoneNumberId: string;
  to: string;
  template: string;
  language: string;
  params: string[];
  at: string;
};

const globalStore = globalThis as unknown as { whatsappStandIn?: Delivered[] };
const delivered = (globalStore.whatsappStandIn ??= []);

const error = (status: number, code: number, message: string) =>
  Response.json({ error: { message, type: "OAuthException", code } }, { status });

type Body = {
  messaging_product?: unknown;
  to?: unknown;
  type?: unknown;
  template?: {
    name?: unknown;
    language?: { code?: unknown };
    components?: { parameters?: { text?: unknown }[] }[];
  };
};

async function send(request: Request, phoneNumberId: string): Promise<Response> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (token === "") return error(401, 190, "Invalid OAuth access token");
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return error(400, 100, "Invalid parameter");
  }
  const to = typeof body.to === "string" ? body.to : "";
  const name = body.template?.name;
  if (body.messaging_product !== "whatsapp" || body.type !== "template" || !/^\d{8,15}$/.test(to)) {
    return error(400, 100, "Invalid parameter");
  }
  if (typeof name !== "string" || name === "")
    return error(400, 132001, "Template name does not exist");
  if (to.endsWith("0000")) return error(400, 131026, "Message undeliverable");
  const wamid = `wamid.STANDIN${randomBytes(12).toString("hex")}`;
  delivered.unshift({
    wamid,
    phoneNumberId,
    to,
    template: name,
    language: String(body.template?.language?.code ?? ""),
    params: (body.template?.components?.[0]?.parameters ?? []).map((p) => String(p.text ?? "")),
    at: new Date().toISOString(),
  });
  delivered.splice(200);
  return Response.json({
    messaging_product: "whatsapp",
    contacts: [{ input: to, wa_id: to }],
    messages: [{ id: wamid }],
  });
}

/** Dispatches `/api/dev/whatsapp/<path>` (an API version segment such as `v23.0/` is ignored). */
export async function handleWhatsappStandIn(request: Request, path: string): Promise<Response> {
  const parts = path.split("/").filter((p) => p !== "" && !/^v\d+(\.\d+)?$/.test(p));
  if (request.method === "GET" && parts.length === 1 && parts[0] === "messages") {
    return Response.json(delivered, { headers: { "Cache-Control": "no-store" } });
  }
  if (request.method === "POST" && parts.length === 2 && parts[1] === "messages") {
    return send(request, parts[0] ?? "");
  }
  return new Response(null, { status: 404 });
}

/** Test helper: the messages the stand-in accepted, latest first. */
export const standInMessages = (): readonly Delivered[] => delivered;
