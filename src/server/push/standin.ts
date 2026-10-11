import "server-only";

import { createPublicKey, verify } from "node:crypto";

import { standInUrl } from "@/server/stand-ins";

/**
 * Local stand-in of a Web Push service (`/api/dev/push/*`, DEV_GATEWAYS only): a subscription's
 * endpoint is `/api/dev/push/{id}`. It accepts what a push service accepts — an `aes128gcm`
 * body with a VAPID authorization whose signature and audience it checks (RFC 8292) — and keeps
 * the last messages in memory (`GET /api/dev/push/{id}`, still encrypted: only the browser's
 * keys read them). An id ending in `-gone` answers 410, like an expired subscription.
 */

type Received = {
  id: string;
  body: string;
  ttl: string | null;
  urgency: string | null;
  at: string;
};

const globalStore = globalThis as unknown as { pushStandIn?: Received[] };
const received = (globalStore.pushStandIn ??= []);

const error = (status: number, message: string) => Response.json({ error: message }, { status });

/** The VAPID header checked like a push service: ES256 signature, audience, expiry. */
function vapidValid(header: string | null): boolean {
  const match = /^vapid t=([^.]+)\.([^.]+)\.([^,\s]+),\s*k=([A-Za-z0-9_-]+)$/.exec(header ?? "");
  if (!match) return false;
  const [, jwtHeader = "", claims = "", signature = "", key = ""] = match;
  const point = Buffer.from(key, "base64url");
  if (point.length !== 65 || point[0] !== 4) return false;
  let payload: { aud?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(claims, "base64url").toString()) as typeof payload;
  } catch {
    return false;
  }
  if (payload.aud !== new URL(standInUrl("push")).origin) return false;
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return false;
  const publicKey = createPublicKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33, 65).toString("base64url"),
    },
  });
  return verify(
    "sha256",
    Buffer.from(`${jwtHeader}.${claims}`),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
}

async function push(request: Request, id: string): Promise<Response> {
  if (!vapidValid(request.headers.get("authorization"))) return error(403, "Invalid VAPID");
  if (request.headers.get("content-encoding") !== "aes128gcm") {
    return error(415, "aes128gcm expected");
  }
  if (id.endsWith("-gone")) return error(410, "Subscription expired");
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length < 21 + 65 + 17 || body.length > 4096) return error(413, "Invalid payload size");
  received.unshift({
    id,
    body: body.toString("base64url"),
    ttl: request.headers.get("ttl"),
    urgency: request.headers.get("urgency"),
    at: new Date().toISOString(),
  });
  received.splice(200);
  return new Response(null, { status: 201 });
}

export async function handlePushStandIn(request: Request, path: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(path)) return error(404, "Unknown subscription");
  if (request.method === "POST") return push(request, path);
  return Response.json({ data: received.filter((m) => m.id === path) });
}
