import assert from "node:assert/strict";
import test from "node:test";

import { createUnsubscribeToken, readUnsubscribeData, readUnsubscribeToken } from "./unsubscribe.ts";

test("unsubscribe tokens are opaque, normalized, and reject tampering", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret";
  try {
    const token = createUnsubscribeToken(" Person@Example.COM ", "12345678-1234-1234-1234-123456789abc");
    assert.doesNotMatch(token, /person|example/i);
    assert.equal(readUnsubscribeToken(token), "person@example.com");
    assert.equal(readUnsubscribeData(token)?.messageId, "12345678-1234-1234-1234-123456789abc");
    assert.equal(readUnsubscribeToken(`${token}x`), null);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});
