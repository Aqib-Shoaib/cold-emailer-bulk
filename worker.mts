import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { claimDelivery, deliverClaimed, heartbeat, recoverStaleDeliveries } from "./lib/campaign-worker.ts";
import { syncInboxIfDue } from "./lib/imap.ts";
import { operationalLog } from "./lib/operations.ts";

const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const startedAt = new Date();
let stopping = false;
let nextInboxCheck = 0;
process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });

await recoverStaleDeliveries();
while (!stopping) {
  await heartbeat(workerId, startedAt);
  if (Date.now() >= nextInboxCheck) {
    const result = await syncInboxIfDue();
    if (!result.ok) operationalLog("error", "inbox_sync_failed", { workerId, error: result.message.slice(0, 200) });
    nextInboxCheck = Date.now() + 30_000;
  }
  const delivery = await claimDelivery(workerId);
  if (delivery) await deliverClaimed(delivery);
  else await new Promise((resolve) => setTimeout(resolve, 2_000));
}
