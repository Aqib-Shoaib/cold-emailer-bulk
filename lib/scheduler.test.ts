import assert from "node:assert/strict";
import test from "node:test";

import { estimateSendMinutes, nextAllowedSendAt, startOfZonedDay, zonedDateTimeToUtc } from "./scheduler.ts";

test("converts scheduled local time and rejects nonexistent DST time", () => {
  assert.equal(zonedDateTimeToUtc("2026-09-25T09:30", "Asia/Karachi")?.toISOString(), "2026-09-25T04:30:00.000Z");
  assert.equal(zonedDateTimeToUtc("2026-03-08T02:30", "America/New_York"), null);
  assert.equal(startOfZonedDay(new Date("2026-09-25T12:00:00Z"), "Asia/Karachi").toISOString(), "2026-09-24T19:00:00.000Z");
});

test("quiet windows and configured throughput delay sends", () => {
  assert.equal(nextAllowedSendAt(new Date("2026-09-25T18:30:00Z"), "Asia/Karachi", "", "22:00-08:00").toISOString(), "2026-09-26T03:00:00.000Z");
  assert.equal(nextAllowedSendAt(new Date("2026-09-25T12:00:00Z"), "Asia/Karachi", "Friday", "").toISOString(), "2026-09-25T19:00:00.000Z");
  assert.equal(estimateSendMinutes(100, { batchMin: 40, batchMax: 50, intervalMin: 3, intervalMax: 7, perMinute: 10, perHour: 120, globalDaily: 2500, campaignDaily: 250 }), 10);
});
