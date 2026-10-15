import { AppException } from "@podosoft/podokit-contracts";
import { JOBS, type JobQueue } from "@podosoft/podokit-runtime";
import { Elysia, t } from "elysia";
import {
  REQUEST_IDENTITY,
  type AppPlugin,
  type ElysiaPlugin,
  type PodokitModule,
  type RequestIdentity,
  type ServiceKey,
} from "../core/services";
import { SSE_EVENTS } from "../events/events.module";
import { PROGRESS_JOB } from "./progress.processor";
import { ProgressWorker } from "./progress.worker";

const PROGRESS_WORKER = Symbol("progress-worker") as ServiceKey<ProgressWorker>;

export function progressRoutes(queue: JobQueue, identity: RequestIdentity): ElysiaPlugin {
  return new Elysia({ name: "podokit.job-progress" })
    .post("/progress", async ({ request, body, set }) => {
      const ownerId = await identity.userId(request);
      if (!ownerId) throw new AppException("AUTH_REQUIRED", "Authentication is required", 401);
      const job = await queue.enqueue(PROGRESS_JOB, { steps: body.steps ?? 5, ownerId });
      set.status = 201;
      return { jobId: job.id };
    }, {
      body: t.Object({ steps: t.Optional(t.Integer({ minimum: 1, maximum: 100 })) }),
      detail: {
        tags: ["progress"],
        summary: "Start a progress job",
        description: "Progress is published on the `job-progress` topic to the caller only.",
      },
    });
}

const progressPlugin: AppPlugin = ({ services }) =>
  progressRoutes(services.resolve(JOBS), services.resolve(REQUEST_IDENTITY));

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
