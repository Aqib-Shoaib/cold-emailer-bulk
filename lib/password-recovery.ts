import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const RECOVERY_CODE_MINUTES = 10;
export const RECOVERY_ATTEMPT_LIMIT = 5;

export function generateRecoveryCode() {
  return String(randomInt(100_000, 1_000_000));
}

export function recoveryCodeHash(userId: string, code: string, secret: string) {
  if (!secret) throw new Error("SESSION_SECRET is required");
  return createHmac("sha256", secret).update(`${userId}:${code}`).digest("hex");
}

export function validRecoveryCode(code: string) {
  return /^\d{6}$/.test(code);
}

export function recoveryCodeMatches(expectedHash: string, userId: string, code: string, secret: string) {
  if (!validRecoveryCode(code) || expectedHash.length !== 64) return false;
  return timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(recoveryCodeHash(userId, code, secret), "hex"));
}
