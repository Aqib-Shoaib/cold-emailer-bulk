import assert from "node:assert/strict";
import test from "node:test";

import { decryptSecret, encryptSecret, isSecretConfigured } from "./crypto.ts";

const KEY = "unit-test-encryption-key";

test("secrets round-trip and differ between encryptions", () => {
  const first = encryptSecret(KEY, "smtp-password-1");
  const second = encryptSecret(KEY, "smtp-password-1");

  assert.equal(decryptSecret(KEY, first), "smtp-password-1");
  assert.notEqual(first, second, "random IVs must make ciphertexts unique");
});

test("ciphertexts are versioned, typed, and not plaintext", () => {
  const stored = encryptSecret(KEY, "smtp-password-1");
  assert.ok(stored.startsWith("v1:"));
  assert.ok(!stored.includes("smtp-password-1"));
});

test("wrong keys and corrupted records decrypt to null instead of crashing", () => {
  const stored = encryptSecret(KEY, "smtp-password-1");
  assert.equal(decryptSecret("another-key", stored), null);
  assert.equal(decryptSecret(KEY, "v1:not-valid-cipher"), null);
  assert.equal(decryptSecret(KEY, "legacy-plaintext-value"), null);
  assert.equal(decryptSecret(KEY, ""), null);
});

test("configured detection requires both key and stored value", () => {
  assert.equal(isSecretConfigured(KEY, "v1:abc.def"), true);
  assert.equal(isSecretConfigured(KEY, null), false);
  assert.equal(isSecretConfigured(undefined, "v1:abc.def"), false);
  assert.equal(isSecretConfigured(undefined, undefined), false);
});
