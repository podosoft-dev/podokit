import { JOBS, type JobQueue, type Unsubscribe } from "@podosoft/podokit-runtime";
import { Elysia, t } from "elysia";
import type { AppPlugin, PodokitModule, ServiceKey } from "../core/services";
import { SSE_EVENTS } from "../events/events.module";
import { processProgress } from "./progress.processor";

class ProgressWorker {
  private unsubscribe?: Unsubscribe;

  constructor(
    private readonly queue: JobQueue,
    private readonly publish: (event: unknown) => Promise<void>,
  ) {}

  async connect(): Promise<void> {
    this.unsubscribe = await this.queue.process("progress", async (payload, job) => {
      await processProgress(payload, (progress) => this.publish({
        type: "job-progress",
        jobId: job.id,
        progress,
      }));
    });
  }

  async close(): Promise<void> {
    await this.unsubscribe?.();
  }
}

const PROGRESS_WORKER = Symbol("progress-worker") as ServiceKey<ProgressWorker>;

const progressPlugin: AppPlugin = ({ services }) => {
  const queue = services.resolve(JOBS);
  return new Elysia({ name: "podokit.job-progress" })
    .post("/progress", async ({ body, set }) => {
      const job = await queue.enqueue("progress", { steps: body.steps ?? 5 });
      set.status = 201;
      return { jobId: job.id };
    }, {
      body: t.Object({ steps: t.Optional(t.Integer({ minimum: 1, maximum: 100 })) }),
      detail: { tags: ["progress"], summary: "Start a progress job" },
    });
};

export const jobProgressModule: PodokitModule = {
  name: "job-progress",
  configure: (_env, services): void => {
    const events = services.resolve(SSE_EVENTS);
    const worker = new ProgressWorker(
      services.resolve(JOBS),
      (event) => events.publishAsync(event),
    );
    services.register(PROGRESS_WORKER, worker, () => worker.close());
    services.onStart(() => worker.connect());
  },
  plugin: progressPlugin,
};
