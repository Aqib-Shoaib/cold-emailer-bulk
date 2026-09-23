import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "./route.ts";

test("health check reports an unavailable database without leaking details", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const error = console.error;
  delete process.env.DATABASE_URL;
  console.error = () => undefined;

  try {
    const response = await GET();

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: "unhealthy",
      checks: { database: "unavailable" },
    });
  } finally {
    console.error = error;
    if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
  }
});
