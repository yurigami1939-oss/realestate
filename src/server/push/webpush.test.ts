import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encryptPayload, vapidAuthorization, vapidKeys, vapidPublicKey } from "./webpush";

const b64 = (value: string) => Buffer.from(value, "base64url");

// RFC 8291 §5 — the example of an encrypted push message.
const vector = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};

/** What a browser does with a message: the decryption of RFC 8291 §3, from its own keys. */
function decrypt(body: Buffer, uaPrivate: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(asPublic);
  const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();
  const info = (text: string) => Buffer.concat([Buffer.from(text), Buffer.from([1])]);
  const ikm = hmac(
    hmac(auth, secret),
    Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]),
  );
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, info("Content-Encoding: aes128gcm\0")).subarray(0, 16);
  const nonce = hmac(prk, info("Content-Encoding: nonce\0")).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  // The last record ends with its delimiter 0x02.
  expect(plain.at(-1)).toBe(2);
  return plain.subarray(0, -1).toString();
}

describe("Web Push", () => {
  it("encrypts like the RFC 8291 example, and the browser's keys read it back", () => {
    const body = encryptPayload(
      Buffer.from(vector.plaintext),
      { p256dh: vector.uaPublic, auth: vector.auth },
      { asPrivate: b64(vector.asPrivate), salt: b64(vector.salt) },
    );
    // Header: the salt, a 4 096-byte record size, the 65-byte application server key.
    expect(body.subarray(0, 16)).toEqual(b64(vector.salt));
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);
    // 41 bytes of text, the delimiter and the 16-byte tag.
    expect(body.length).toBe(21 + 65 + 41 + 1 + 16);
    expect(decrypt(body, b64(vector.uaPrivate), b64(vector.auth))).toBe(vector.plaintext);
    // A fresh key and salt each time.
    const again = encryptPayload(Buffer.from("x"), { p256dh: vector.uaPublic, auth: vector.auth });
    expect(decrypt(again, b64(vector.uaPrivate), b64(vector.auth))).toBe("x");
  });

  it("signs the push request with the VAPID key", () => {
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", 1_700_000_000_000);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, jwtHeader = "", claims = "", signature = "", key = ""] = match ?? [];
    expect(key).toBe(vapidPublicKey());
    expect(JSON.parse(b64(claims).toString())).toMatchObject({
      aud: "https://fcm.googleapis.com",
      exp: 1_700_000_000 + 12 * 3600,
    });
    const publicKey = vapidKeys().publicKey;
    const jwk = {
      kty: "EC",
      crv: "P-256",
      x: publicKey.subarray(1, 33).toString("base64url"),
      y: publicKey.subarray(33, 65).toString("base64url"),
    };
    expect(
      verify(
        "sha256",
        Buffer.from(`${jwtHeader}.${claims}`),
        { key: createPublicKey({ format: "jwk", key: jwk }), dsaEncoding: "ieee-p1363" },
        b64(signature),
      ),
    ).toBe(true);
  });
});
