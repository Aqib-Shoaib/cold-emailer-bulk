import assert from "node:assert/strict";
import test from "node:test";

import { applyTracking, createTrackingToken, readTrackingToken } from "./tracking.ts";

test("tracking tokens are opaque, validated, and preserve an http target", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "tracking-test-secret";
  try {
    const value = { messageId: "12345678-1234-1234-1234-123456789abc", url: "https://example.test/page?a=1" };
    const token = createTrackingToken(value);
    assert.doesNotMatch(token, /example|12345678/);
    assert.deepEqual(readTrackingToken(token), value);
    assert.equal(readTrackingToken(`${token}x`), null);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("disabled tracking emits no tracking URLs and enabled tracking skips unsubscribe", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "tracking-test-secret";
  try {
    const rendered = { text: "Visit https://example.test/page\nUnsubscribe: https://app.test/unsubscribe?token=x", html: '<p>Visit https://example.test/page</p><a href="https://app.test/unsubscribe?token=x">Unsubscribe</a>' };
    const disabled = applyTracking(rendered, { baseUrl: "https://app.test", messageId: "12345678-1234-1234-1234-123456789abc", open: false, click: false });
    assert.deepEqual(disabled, rendered);
    const enabled = applyTracking(rendered, { baseUrl: "https://app.test", messageId: "12345678-1234-1234-1234-123456789abc", open: true, click: true });
    assert.match(enabled.text, /\/api\/track\/click\?token=/);
    assert.match(enabled.html, /\/api\/track\/open\?token=/);
    assert.match(enabled.html, /href="https:\/\/app\.test\/unsubscribe\?token=x"/);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});
