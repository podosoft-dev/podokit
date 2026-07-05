import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ProgressController } from "./progress.controller";
import { ProgressBridge } from "./progress.bridge";

// API side: enqueue progress jobs and relay their progress to SSE.
// RedisService and EventsService are provided globally by their modules.
@Module({
  imports: [BullModule.registerQueue({ name: "progress" })],
  controllers: [ProgressController],
  providers: [ProgressBridge],
})
export class JobProgressModule {}
