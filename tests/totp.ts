import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 (the secret of an otpauth:// link) → bytes. */
function base32(input: string): Buffer {
  let bits = "";
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error(`base32: unexpected ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The 6-digit TOTP code (RFC 6238: SHA-1, 30 s) an authenticator app shows for this link. */
export function totpCode(otpauthUri: string, at = Date.now()): string {
  const secret = new URL(otpauthUri).searchParams.get("secret");
  if (!secret) throw new Error("totp: no secret in the link");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

/** The same code from the bare secret (the key shown to type by hand). */
export const totpFromSecret = (secret: string, at = Date.now()) =>
  totpCode(`otpauth://totp/app?secret=${encodeURIComponent(secret.trim())}`, at);
