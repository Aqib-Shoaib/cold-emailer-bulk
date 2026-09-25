import { applyRetention, operationalLog } from "./lib/operations.ts";
import { monitorOnce } from "./lib/monitor.ts";

let stopping = false;
let lastRetention = 0;
process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });

while (!stopping) {
  try {
    await monitorOnce();
    if (Date.now() - lastRetention >= 86_400_000) {
      operationalLog("info", "retention_complete", await applyRetention());
      lastRetention = Date.now();
    }
  } catch (error) {
    operationalLog("error", "monitor_failed", { error: error instanceof Error ? error.message.slice(0, 200) : "Unknown error" });
  }
  await new Promise((resolve) => setTimeout(resolve, 60_000));
}
