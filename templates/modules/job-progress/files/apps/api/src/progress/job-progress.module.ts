import { Queue } from "bullmq";
import { Elysia, t } from "elysia";
import type { AppPlugin, PodokitModule, ServiceKey } from "../core/services";
import { EVENTS } from "../events/events.module";
import { redisConnection } from "../jobs/queue";
import { REDIS } from "../redis/redis.module";
import { ProgressBridge } from "./progress.bridge";

const PROGRESS_QUEUE = Symbol("progress-queue") as ServiceKey<Queue>;
const PROGRESS_BRIDGE = Symbol("progress-bridge") as ServiceKey<ProgressBridge>;

const progressPlugin: AppPlugin = ({ services }) => {
  const queue = services.resolve(PROGRESS_QUEUE);
  return new Elysia({ name: "podokit.job-progress" })
    .post("/progress", async ({ body, set }) => {
      const job = await queue.add("progress", { steps: body.steps ?? 5 });
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
    const queue = new Queue("progress", { connection: redisConnection() });
    const bridge = new ProgressBridge(services.resolve(REDIS), services.resolve(EVENTS));
    services.register(PROGRESS_QUEUE, queue, () => queue.close());
    services.register(PROGRESS_BRIDGE, bridge, () => bridge.close());
    services.onStart(() => bridge.connect());
  },
  plugin: progressPlugin,
};
