import assert from "node:assert/strict";
import test from "node:test";

import { workerIncident } from "./monitor.ts";

test("worker inactivity is reported only after the stale boundary", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  assert.equal(workerIncident(new Date("2026-09-25T11:59:00Z"), now), null);
  assert.equal(workerIncident(null, now)?.id, "worker:stale");
  assert.equal(workerIncident(new Date("2026-09-25T11:57:59Z"), now)?.id, "worker:stale");
});
