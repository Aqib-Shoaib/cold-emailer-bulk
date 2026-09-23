import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION = "v1";

/**
 * Secret fields stored inside the single AppSettings row. Values are encrypted
 * with the runtime SETTINGS_ENCRYPTION_KEY and are never returned to browsers.
 */
export type SecretField = "smtp_password_enc" | "imap_password_enc" | "ai_api_key_enc";

export const SECRET_FIELDS: readonly SecretField[] = [
  "smtp_password_enc",
  "imap_password_enc",
  "ai_api_key_enc",
] as const;

function keyFrom(encryptionKey: string) {
  return createHash("sha256").update(encryptionKey, "utf8").digest();
}

function encoded(stored: string) {
  if (!stored.startsWith(`${VERSION}:`)) return null;
  const parts = stored.slice(VERSION.length + 1).split(".");
  if (parts.length !== 3) return null;

  const iv = Buffer.from(parts[0], "base64url");
  const authTag = Buffer.from(parts[1], "base64url");
  const data = Buffer.from(parts[2], "base64url");
  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) return null;

  return { iv, authTag, data };
}

export function encryptSecret(encryptionKey: string, plaintext: string) {
  if (!plaintext) throw new Error("Cannot encrypt an empty secret");
  if (!encryptionKey) throw new Error("SETTINGS_ENCRYPTION_KEY is required");

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyFrom(encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${VERSION}:${iv.toString("base64url")}.${authTag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(encryptionKey: string, stored: string) {
  if (!encryptionKey) throw new Error("SETTINGS_ENCRYPTION_KEY is required");

  const decoded = encoded(stored);
  if (!decoded || decoded.iv.length !== IV_LENGTH) return null;

  const decipher = createDecipheriv(ALGORITHM, keyFrom(encryptionKey), decoded.iv);
  decipher.setAuthTag(decoded.authTag);
  try {
    return Buffer.concat([
      decipher.update(decoded.data),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key or corrupted record: treat as not configured rather than crash.
    return null;
  }
}

export function isSecretConfigured(encryptionKey: string | undefined, stored: string | null | undefined) {
  return Boolean(encryptionKey && stored && decryptSecret(encryptionKey, stored));
}
