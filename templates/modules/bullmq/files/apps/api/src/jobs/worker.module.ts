import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { DemoProcessor } from "./demo.processor";
import { DEMO_QUEUE, redisConnection } from "./queue";
// podokit:begin:worker-imports
// podokit:end:worker-imports

// Consumer side: runs BullMQ processors. Bootstrapped by main-worker.ts as a
// separate process so workers scale independently of the API.
@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: DEMO_QUEUE }),
    // podokit:begin:worker-queues
    // podokit:end:worker-queues
  ],
  providers: [
    DemoProcessor,
    // podokit:begin:worker-providers
    // podokit:end:worker-providers
  ],
})
export class WorkerModule {}
