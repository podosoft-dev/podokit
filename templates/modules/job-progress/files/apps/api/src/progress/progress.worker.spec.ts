import { afterEach, describe, expect, it } from "bun:test";
import { AppException } from "@podosoft/podokit-contracts";
import {
  MemoryEventBus,
  type JobHandler,
  type JobQueue,
  type JobReference,
} from "@podosoft/podokit-runtime";
import { Elysia } from "elysia";
import type { RequestIdentity } from "../core/services";
import type { EventStream, StreamFrame } from "../events/event-stream";
import { EventsService } from "../events/events.service";
import { ReadinessService } from "../health/readiness.service";
import { progressRoutes } from "./job-progress.module";
import { JOB_PROGRESS_TOPIC } from "./progress.processor";
import { ProgressWorker } from "./progress.worker";

interface FakeQueue extends JobQueue {
  enqueued: Array<{ name: string; payload: unknown }>;
  run(payload: unknown, job: JobReference): Promise<void>;
}

function fakeQueue(): FakeQueue {
  const handlers = new Map<string, JobHandler>();
  const enqueued: Array<{ name: string; payload: unknown }> = [];
  return {
    enqueued,
    enqueue: async (name, payload) => {
      enqueued.push({ name, payload });
      return { id: `job-${enqueued.length}`, name };
    },
    get: async () => null,
    process: async (name, handler) => {
      handlers.set(name, handler);
      return () => {
        handlers.delete(name);
      };
    },
    run: async (payload, job) => {
      const handler = handlers.get(job.name);
      if (!handler) throw new Error(`no handler for ${job.name}`);
      await handler(payload, job);
    },
    schedule: async () => undefined,
    unschedule: async () => undefined,
    close: () => undefined,
  };
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function harness(): Promise<{ events: EventsService; queue: FakeQueue }> {
  const events = new EventsService(new MemoryEventBus(), new ReadinessService());
  await events.connect();
  const queue = fakeQueue();
  const worker = new ProgressWorker(queue, (event) => events.publishAsync(event), async () => undefined);
  await worker.connect();
  cleanups.push(async () => {
    await worker.close();
    await events.close();
  });
  return { events, queue };
}

function stream(events: EventsService, userId: string): Promise<EventStream> {
  return events.open({ userId, roles: [] }, [JOB_PROGRESS_TOPIC, "marker"], new AbortController().signal);
}

function decoded(frame: StreamFrame | undefined): unknown {
  return frame?.kind === "event" ? JSON.parse(frame.data) : frame;
}

async function progressBeforeMarker(events: EventsService, target: EventStream): Promise<unknown[]> {
  await events.publishAsync({ topic: "marker", data: "end" });
  const frames: unknown[] = [];
  for (;;) {
    const frame = decoded(await target.next());
    if (JSON.stringify(frame) === JSON.stringify({ topic: "marker", data: "end" })) return frames;
    frames.push(frame);
  }
}

describe("progress worker", () => {
  it("sends a job's progress only to the user who started it", async () => {
    const { events, queue } = await harness();
    const owner = await stream(events, "alice");
    const other = await stream(events, "bob");

    await queue.run({ steps: 2, ownerId: "alice" }, { id: "job-1", name: "progress" });

    expect(await progressBeforeMarker(events, owner)).toEqual([
      { topic: JOB_PROGRESS_TOPIC, data: { jobId: "job-1", progress: 50 } },
      { topic: JOB_PROGRESS_TOPIC, data: { jobId: "job-1", progress: 100 } },
    ]);
    expect(await progressBeforeMarker(events, other)).toEqual([]);
  });

  it("publishes nothing for a job without an owner", async () => {
    const { events, queue } = await harness();
    const listener = await stream(events, "alice");
    await queue.run({ steps: 2 }, { id: "legacy", name: "progress" });
    expect(await progressBeforeMarker(events, listener)).toEqual([]);
  });
});

describe("progress routes", () => {
  const identity = (userId: string | undefined): RequestIdentity => ({
    userId: async () => userId,
    isAdmin: async () => false,
    roles: async () => [],
    activeOrganizationId: async () => undefined,
  });

  async function start(queue: JobQueue, userId: string | undefined): Promise<Response> {
    const app = new Elysia()
      .onError(({ error, set }) => {
        if (!(error instanceof AppException)) return undefined;
        set.status = error.statusCode;
        return { code: error.code };
      })
      .use(progressRoutes(queue, identity(userId)));
    return app.handle(new Request("http://localhost/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steps: 3 }),
    }));
  }

  it("records the caller as the job owner", async () => {
    const queue = fakeQueue();
    const response = await start(queue, "alice");
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ jobId: "job-1" });
    expect(queue.enqueued).toEqual([{ name: "progress", payload: { steps: 3, ownerId: "alice" } }]);
  });

  it("requires a signed-in user", async () => {
    const queue = fakeQueue();
    const response = await start(queue, undefined);
    expect(response.status).toBe(401);
    expect(queue.enqueued).toEqual([]);
  });
});
