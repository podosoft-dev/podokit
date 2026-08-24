import { RedisClient } from "bun";
import type { Job } from "bullmq";
import { redisConnectionUrl } from "../config/redis.connection";

export const PROGRESS_CHANNEL = "job:progress";

const redis = new RedisClient(redisConnectionUrl());

export async function processProgressJob(job: Job<{ steps?: number }>): Promise<{ done: true }> {
  const steps = job.data.steps ?? 5;
  for (let index = 1; index <= steps; index += 1) {
    await Bun.sleep(400);
    const progress = Math.round((index / steps) * 100);
    await job.updateProgress(progress);
    await redis.publish(PROGRESS_CHANNEL, JSON.stringify({ jobId: job.id, progress }));
  }
  return { done: true };
}
