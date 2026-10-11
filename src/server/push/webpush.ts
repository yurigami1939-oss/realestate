import "server-only";

import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";

import { env } from "@/env";

/**
 * Web Push without a library (CLAUDE.md §7 Push notifications): the payload encrypted for the
 * browser's subscription (RFC 8291, `aes128gcm` content coding of RFC 8188) and the request
 * signed with the application server's VAPID key (RFC 8292).
 */

export type PushSubscriptionKeys = {
  /** The browser's ECDH P-256 public key (uncompressed point), base64url. */
  p256dh: string;
  /** The browser's authentication secret (16 bytes), base64url. */
  auth: string;
};

const b64url = (buffer: Buffer) => buffer.toString("base64url");
const fromB64url = (value: string) => Buffer.from(value, "base64url");

/** HKDF-Expand for one block (L ≤ 32): HMAC-SHA-256(prk, info || 0x01). */
const expand = (prk: Buffer, info: Buffer, length: number) =>
  createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, length);

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** Record size announced in the header (the payload is one record, well under it). */
const RECORD_SIZE = 4096;

/**
 * Encrypts a push message for a subscription (RFC 8291 §3): an ephemeral ECDH key pair, the
 * shared secret mixed with the browser's auth secret, then AES-128-GCM over the payload and
 * its last-record delimiter, behind the `aes128gcm` header (salt, record size, key id = the
 * ephemeral public key). `options` fixes the ephemeral key and salt (the RFC's test vector).
 */
export function encryptPayload(
  payload: Buffer,
  keys: PushSubscriptionKeys,
  options: { asPrivate?: Buffer; salt?: Buffer } = {},
): Buffer {
  const uaPublic = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  const ecdh = createECDH("prime256v1");
  if (options.asPrivate) ecdh.setPrivateKey(options.asPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = expand(hmac(authSecret, ecdhSecret), keyInfo, 32);
  const salt = options.salt ?? randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

/** The VAPID key pair: VAPID_PRIVATE_KEY, else derived from BETTER_AUTH_SECRET (like secrets). */
export function vapidKeys(): { privateKey: Buffer; publicKey: Buffer } {
  const privateKey = env.VAPID_PRIVATE_KEY
    ? fromB64url(env.VAPID_PRIVATE_KEY)
    : Buffer.from(hkdfSync("sha256", env.BETTER_AUTH_SECRET, "", "realestate:vapid", 32));
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privateKey);
  return { privateKey, publicKey: ecdh.getPublicKey() };
}

/** The application server key a browser subscribes with (base64url, uncompressed point). */
export const vapidPublicKey = (): string => b64url(vapidKeys().publicKey);

/**
 * The `Authorization: vapid` header of a push request (RFC 8292): a JWT for the push service's
 * origin, valid 12 hours, signed ES256 with the VAPID key, and that key.
 */
export function vapidAuthorization(endpoint: string, now = Date.now()): string {
  const { privateKey, publicKey } = vapidKeys();
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT,
      }),
    ),
  );
  const key = createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: b64url(privateKey),
      x: b64url(publicKey.subarray(1, 33)),
      y: b64url(publicKey.subarray(33, 65)),
    },
  });
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${b64url(publicKey)}`;
}

export type PushResult =
  | { ok: true }
  /** `gone`: the subscription expired or was withdrawn (404 / 410): forget it. */
  | { ok: false; gone: boolean; retry: boolean; error: string };

/** Sends one encrypted message to a subscription's push service. */
export async function sendPush(
  subscription: { endpoint: string } & PushSubscriptionKeys,
  payload: object,
): Promise<PushResult> {
  const body = encryptPayload(Buffer.from(JSON.stringify(payload)), subscription);
  let response: Response;
  try {
    response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        authorization: vapidAuthorization(subscription.endpoint),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: "86400",
        urgency: "normal",
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return { ok: false, gone: false, retry: true, error: `unreachable: ${String(error)}` };
  }
  if (response.ok) return { ok: true };
  const gone = response.status === 404 || response.status === 410;
  const retry = response.status === 429 || response.status >= 500;
  return { ok: false, gone, retry, error: `HTTP ${response.status}` };
}
