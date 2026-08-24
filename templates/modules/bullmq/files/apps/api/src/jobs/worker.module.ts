import { Worker, type Processor } from "bullmq";
import { processDemoJob } from "./demo.processor";
import { DEMO_QUEUE, redisConnection } from "./queue";
// podokit:begin:worker-imports
// podokit:end:worker-imports

interface WorkerDefinition {
  queue: string;
  processor: Processor;
}

const definitions: WorkerDefinition[] = [
  { queue: DEMO_QUEUE, processor: processDemoJob },
  // podokit:begin:worker-processors
  // podokit:end:worker-processors
];

export function startWorkers(): Worker[] {
  return definitions.map(({ queue, processor }) =>
    new Worker(queue, processor, { connection: redisConnection() })
  );
}
