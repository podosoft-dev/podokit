import "dotenv/config";
import { PROVIDERS } from "./config/providers";
import { startWorkers } from "./jobs/worker.module";

if (PROVIDERS.jobs !== "bullmq") {
  throw new Error("The BullMQ worker cannot start unless jobs=bullmq is selected");
}

const workers = startWorkers();

for (const worker of workers) {
  worker.on("failed", (job, error) => {
    process.stderr.write(`Process job failed: ${job?.id ?? "unknown"} ${error.message}\n`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.all(workers.map((worker) => worker.close())).finally(() => process.exit(0));
  });
}
