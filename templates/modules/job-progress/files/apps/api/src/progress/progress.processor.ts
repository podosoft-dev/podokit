import type { EventEnvelope } from "../events/event-envelope";

export const PROGRESS_JOB = "progress";
export const JOB_PROGRESS_TOPIC = "job-progress";

export interface ProgressPayload {
  steps?: number;
  /** The user who started the job; only that user receives its progress. */
  ownerId?: string;
}

export interface JobProgress {
  jobId: string;
  progress: number;
}

export function progressPayload(value: unknown): ProgressPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const { steps, ownerId } = value as Record<string, unknown>;
  return {
    ...(typeof steps === "number" ? { steps } : {}),
    ...(typeof ownerId === "string" && ownerId.length > 0 ? { ownerId } : {}),
  };
}

export function progressEvent(
  jobId: string,
  ownerId: string,
  progress: number,
): EventEnvelope<JobProgress> {
  return {
    topic: JOB_PROGRESS_TOPIC,
    audience: { userIds: [ownerId] },
    data: { jobId, progress },
  };
}

export async function processProgress(
  value: unknown,
  publish: (progress: number) => Promise<void>,
  delay: (milliseconds: number) => Promise<unknown> = Bun.sleep,
): Promise<{ done: true }> {
  const steps = progressPayload(value).steps ?? 5;
  for (let index = 1; index <= steps; index += 1) {
    await delay(400);
    const progress = Math.round((index / steps) * 100);
    await publish(progress);
  }
  return { done: true };
}
