import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, isValidPassword, verifyPassword } from "./password.ts";

test("password hashes verify only the original password", async () => {
  const hash = await hashPassword("a-secure-test-password");

  assert.equal(await verifyPassword("a-secure-test-password", hash), true);
  assert.equal(await verifyPassword("the-wrong-password", hash), false);
  assert.equal(await verifyPassword("anything", "malformed"), false);
});

test("accepts passwords from 12 through 200 characters", () => {
  assert.equal(isValidPassword("short"), false);
  assert.equal(isValidPassword("a".repeat(12)), true);
  assert.equal(isValidPassword("a".repeat(200)), true);
  assert.equal(isValidPassword("a".repeat(201)), false);
});
