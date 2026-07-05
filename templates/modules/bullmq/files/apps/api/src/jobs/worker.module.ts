import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { DemoProcessor } from "./demo.processor";
import { DEMO_QUEUE, redisConnection } from "./queue";

// Consumer side: runs the BullMQ processor. Bootstrapped by main-worker.ts
// as a separate process so workers scale independently of the API.
@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: DEMO_QUEUE }),
  ],
  providers: [DemoProcessor],
})
export class WorkerModule {}
