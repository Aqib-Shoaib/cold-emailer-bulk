import { decryptSecret, encryptSecret } from "./crypto.ts";
import { normalizeEmail } from "./auth.ts";

function key() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is required");
  return value;
}

export interface UnsubscribeData {
  email: string;
  messageId?: string;
}

export function createUnsubscribeToken(email: string, messageId?: string) {
  return encryptSecret(key(), JSON.stringify({ email: normalizeEmail(email), messageId }));
}

export function readUnsubscribeData(token: string): UnsubscribeData | null {
  const plain = decryptSecret(key(), token);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as { email?: unknown; messageId?: unknown };
    if (typeof parsed.email !== "string" || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(parsed.email)) return null;
    if (parsed.messageId !== undefined && (typeof parsed.messageId !== "string" || !/^[0-9a-f-]{36}$/i.test(parsed.messageId))) return null;
    return { email: normalizeEmail(parsed.email), messageId: parsed.messageId };
  } catch {
    // Backward compatibility for links emitted before message context was added.
    return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(plain) ? { email: normalizeEmail(plain) } : null;
  }
}

export function readUnsubscribeToken(token: string) {
  return readUnsubscribeData(token)?.email ?? null;
}
