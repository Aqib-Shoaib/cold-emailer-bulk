import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, verifyPassword } from "./password.ts";

test("password hashes verify only the original password", async () => {
  const hash = await hashPassword("a-secure-test-password");

  assert.equal(await verifyPassword("a-secure-test-password", hash), true);
  assert.equal(await verifyPassword("the-wrong-password", hash), false);
  assert.equal(await verifyPassword("anything", "malformed"), false);
});
