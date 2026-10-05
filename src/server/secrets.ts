import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { env } from "@/env";

const VERSION = "v1";

/** SECRETS_KEY when set, else a key derived from BETTER_AUTH_SECRET (CLAUDE.md §5 Config). */
function secretsKey(): Buffer {
  if (env.SECRETS_KEY) return Buffer.from(env.SECRETS_KEY, "base64");
  return Buffer.from(hkdfSync("sha256", env.BETTER_AUTH_SECRET, "", "realestate:secrets", 32));
}

/**
 * Encrypts a secret stored for an organization (gateway password, API token) with
 * AES-256-GCM: "v1.<iv>.<tag>.<ciphertext>" in base64url. Decrypted only on the server.
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretsKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

/** Throws when the value was not sealed with the current key (or was tampered with). */
export function decryptSecret(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error("decryptSecret: unknown format");
  }
  const decipher = createDecipheriv("aes-256-gcm", secretsKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
