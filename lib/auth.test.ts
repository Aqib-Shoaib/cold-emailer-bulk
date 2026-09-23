import assert from "node:assert/strict";
import test from "node:test";
import { digest, isSameOrigin, loginThrottleKey, normalizeEmail } from "./auth.ts";

test("normalizes email and creates stable non-plain throttle keys", () => {
  assert.equal(normalizeEmail(" Admin@Example.COM "), "admin@example.com");
  assert.equal(loginThrottleKey("Admin@Example.com"), loginThrottleKey(" admin@example.COM "));
  assert.equal(loginThrottleKey("admin@example.com").length, 64);
  assert.ok(!loginThrottleKey("admin@example.com").includes("admin"));
});

test("digests opaque session tokens", () => {
  assert.equal(digest("token"), digest("token"));
  assert.notEqual(digest("token"), digest("other"));
});

test("accepts only matching request origins", () => {
  const request = (origin: string, host = "app.example.com") =>
    new Request("https://app.example.com", { headers: { origin, host } });

  assert.equal(isSameOrigin(request("https://app.example.com") as never), true);
  assert.equal(isSameOrigin(request("https://evil.example") as never), false);
});
