import type { JobQueue, Unsubscribe } from "@podosoft/podokit-runtime";
import type { EventEnvelope } from "../events/event-envelope";
import {
  PROGRESS_JOB,
  processProgress,
  progressEvent,
  progressPayload,
} from "./progress.processor";

export class ProgressWorker {
  private unsubscribe?: Unsubscribe;

  constructor(
    private readonly queue: JobQueue,
    private readonly publish: (event: EventEnvelope) => Promise<void>,
    private readonly delay?: (milliseconds: number) => Promise<unknown>,
  ) {}

  async connect(): Promise<void> {
    this.unsubscribe = await this.queue.process(PROGRESS_JOB, async (payload, job) => {
      // Jobs enqueued before progress had owners run without publishing,
      // because there is nobody they may be shown to.
      const ownerId = progressPayload(payload).ownerId;
      await processProgress(
        payload,
        async (progress) => {
          if (ownerId) await this.publish(progressEvent(job.id, ownerId, progress));
        },
        this.delay,
      );
    });
  }

  async close(): Promise<void> {
    await this.unsubscribe?.();
  }
}
