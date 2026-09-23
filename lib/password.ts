import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export function isValidPassword(password: string) {
  return password.length >= 12 && password.length <= 200;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;

  return `scrypt:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, encodedSalt, encodedKey] = storedHash.split(":");

  if (algorithm !== "scrypt" || !encodedSalt || !encodedKey) return false;

  const expected = Buffer.from(encodedKey, "base64url");
  if (expected.length !== KEY_LENGTH) return false;

  const actual = (await scrypt(
    password,
    Buffer.from(encodedSalt, "base64url"),
    KEY_LENGTH,
  )) as Buffer;

  return timingSafeEqual(actual, expected);
}
