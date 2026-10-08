import assert from "node:assert/strict";
import test from "node:test";
import { digest, isSameOrigin, loginThrottleKey, normalizeEmail, recoveryThrottleKey, requestOrigin } from "./auth.ts";

test("normalizes email and creates stable non-plain throttle keys", () => {
  assert.equal(normalizeEmail(" Admin@Example.COM "), "admin@example.com");
  assert.equal(loginThrottleKey("Admin@Example.com"), loginThrottleKey(" admin@example.COM "));
  assert.equal(loginThrottleKey("admin@example.com").length, 64);
  assert.ok(!loginThrottleKey("admin@example.com").includes("admin"));
  assert.equal(recoveryThrottleKey("Admin@Example.com"), recoveryThrottleKey(" admin@example.COM "));
  assert.notEqual(recoveryThrottleKey("admin@example.com"), loginThrottleKey("admin@example.com"));
});

test("digests opaque session tokens", () => {
  assert.equal(digest("token"), digest("token"));
  assert.notEqual(digest("token"), digest("other"));
});

test("accepts only matching request origins", () => {
  const appUrl = process.env.APP_URL;
  process.env.APP_URL = "https://app.example.com";
  const request = (origin: string, host = "app.example.com") =>
    new Request("https://app.example.com", { headers: { origin, host } });

  try {
    assert.equal(isSameOrigin(request("https://app.example.com") as never), true);
    assert.equal(isSameOrigin(request("https://evil.example") as never), false);
    assert.equal(isSameOrigin(request("https://evil.example", "evil.example") as never), false);
    assert.equal(requestOrigin(request("https://app.example.com") as never), "https://app.example.com");
  } finally {
    if (appUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = appUrl;
  }
});
