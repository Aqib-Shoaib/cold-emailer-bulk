import assert from "node:assert/strict";
import test from "node:test";

import {
  generateRecoveryCode,
  recoveryCodeHash,
  recoveryCodeMatches,
  validRecoveryCode,
} from "./password-recovery.ts";

test("recovery codes are six digits and matched through a keyed digest", () => {
  const code = generateRecoveryCode();
  const hash = recoveryCodeHash("user-id", code, "test-secret");

  assert.match(code, /^\d{6}$/);
  assert.equal(hash.length, 64);
  assert.ok(!hash.includes(code));
  assert.equal(recoveryCodeMatches(hash, "user-id", code, "test-secret"), true);
  assert.equal(recoveryCodeMatches(hash, "user-id", "000000", "test-secret"), false);
  assert.equal(validRecoveryCode("12345"), false);
});
