import "dotenv/config";
import { startWorkers } from "./jobs/worker.module";

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
