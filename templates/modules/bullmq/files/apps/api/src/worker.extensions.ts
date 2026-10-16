import type { WorkerDefinition, WorkerSetup } from "./jobs/worker.module";

// This owned file is never overwritten by `podo update`. Return the queues the
// BullMQ worker process (`main-worker.ts`) consumes for the application, next to
// PodoKit's. Open what the processors need here and release it with
// `setup.onClose`, which runs after the workers stop. For example:
//
//   const database = new Database(validateEnv(process.env));
//   setup.onClose(() => database.close());
//   return [{ queue: "reports", processor: (job) => buildReport(database, job.data), options: { concurrency: 2 } }];
export async function configureWorkers(_setup: WorkerSetup): Promise<WorkerDefinition[]> {
  return [];
}
