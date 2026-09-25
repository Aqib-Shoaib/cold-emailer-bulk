import assert from "node:assert/strict";
import test from "node:test";

import { parseStatisticsFilters, rate } from "./statistics.ts";

test("statistics filters accept only real shapes and make the end date inclusive", () => {
  const filters = parseStatisticsFilters({ from: "2026-09-01", to: "2026-09-25", campaign: "12345678-1234-4234-8234-123456789abc", template: "bad" });
  assert.equal(filters.from?.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(filters.to?.toISOString(), "2026-09-26T00:00:00.000Z");
  assert.equal(filters.campaignId, "12345678-1234-4234-8234-123456789abc");
  assert.equal(filters.templateId, undefined);
});

test("rates state an empty denominator instead of claiming zero percent", () => {
  assert.equal(rate(1, 4), "25.0%");
  assert.equal(rate(0, 0), "—");
});
