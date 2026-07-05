import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { RedisService } from "../redis/redis.service";

export const PROGRESS_CHANNEL = "job:progress";

// Runs in the worker process. Reports progress both to BullMQ and, via Redis
// pub/sub, to the API process (which relays it to SSE clients).
@Processor("progress")
export class ProgressProcessor extends WorkerHost {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async process(job: Job<{ steps?: number }>): Promise<{ done: true }> {
    const steps = job.data.steps ?? 5;
    for (let i = 1; i <= steps; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const progress = Math.round((i / steps) * 100);
      await job.updateProgress(progress);
      await this.redis.publish(PROGRESS_CHANNEL, JSON.stringify({ jobId: job.id, progress }));
    }
    return { done: true };
  }
}
