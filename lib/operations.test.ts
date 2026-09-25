import assert from "node:assert/strict";
import test from "node:test";

import { retryIsSafe } from "./operations.ts";

test("manual retry is limited to definitively failed or never-started delivery", () => {
  assert.equal(retryIsSafe("FAILED", null), true);
  assert.equal(retryIsSafe("FAILED", "FAILED"), true);
  assert.equal(retryIsSafe("FAILED", "UNKNOWN"), false);
  assert.equal(retryIsSafe("FAILED", "SMTP_ACCEPTED"), false);
  assert.equal(retryIsSafe("FAILED", "BOUNCED"), false);
  assert.equal(retryIsSafe("PENDING", "FAILED"), false);
});
