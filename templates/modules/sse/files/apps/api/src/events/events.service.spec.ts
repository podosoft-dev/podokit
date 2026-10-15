import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { MemoryEventBus } from "@podosoft/podokit-runtime";
import { ReadinessService } from "../health/readiness.service";
import { encodeFrame, eventStreamResponse, type Scheduler, type StreamFrame } from "./event-stream";
import { EventsService, type EventsServiceOptions } from "./events.service";

interface FakeScheduler extends Scheduler {
  active(): number;
  tick(): void;
}

function fakeScheduler(): FakeScheduler {
  const tasks = new Set<() => void>();
  return {
    every: (_intervalMs, task) => {
      const entry = (): void => task();
      tasks.add(entry);
      return () => {
        tasks.delete(entry);
      };
    },
    active: () => tasks.size,
    tick: () => {
      for (const task of [...tasks]) task();
    },
  };
}

const services: EventsService[] = [];

async function service(
  options: EventsServiceOptions = {},
  bus = new MemoryEventBus(),
): Promise<EventsService> {
  const events = new EventsService(bus, new ReadinessService(), {
    scheduler: fakeScheduler(),
    ...options,
  });
  await events.connect();
  services.push(events);
  return events;
}

function decoded(frame: StreamFrame | undefined): unknown {
  return frame?.kind === "event" ? JSON.parse(frame.data) : frame;
}

afterEach(async () => {
  for (const events of services.splice(0)) await events.close();
});

describe("EventsService", () => {
  it("publishes through the transport and delivers locally", async () => {
    const readiness = new ReadinessService();
    const events = new EventsService(new MemoryEventBus(), readiness, { scheduler: fakeScheduler() });
    services.push(events);
    const received: unknown[] = [];
    events.subscribe((data) => received.push(data));
    await events.connect();
    const stream = events.open(new AbortController().signal);

    await events.publishAsync({ type: "changed" });

    expect(received).toEqual([{ type: "changed" }]);
    expect(await stream.next()).toEqual({ kind: "event", id: "1", data: '{"type":"changed"}' });
    await expect(readiness.run()).resolves.toEqual({ events: "up" });
  });

  it("rejects events larger than the configured limit", async () => {
    const events = await service({}, new MemoryEventBus({ maxEventBytes: 8 }));
    await expect(events.publishAsync({ message: "too large" })).rejects.toThrow(
      "Event exceeds maxEventBytes",
    );
  });
});

describe("per-connection safety", () => {
  it("drops the backlog of a slow client and sends one resync", async () => {
    const events = await service({ queueLimit: 3 });
    const stream = events.open(new AbortController().signal);
    for (let index = 1; index <= 5; index += 1) await events.publishAsync(index);

    expect(await stream.next()).toEqual({ kind: "resync" });
    expect(decoded(await stream.next())).toBe(5);
    await events.publishAsync(6);
    expect(decoded(await stream.next())).toBe(6);
  });

  it("reuses one heartbeat timer per connection and releases it on disconnect", async () => {
    const scheduler = fakeScheduler();
    const events = await service({ scheduler });
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const streams = controllers.map((controller) => events.open(controller.signal));
    expect(scheduler.active()).toBe(3);

    for (let index = 0; index < 1_000; index += 1) {
      await events.publishAsync(index);
      for (const stream of streams) await stream.next();
    }
    expect(scheduler.active()).toBe(3);

    scheduler.tick();
    const first = streams[0];
    if (!first) throw new Error("missing stream");
    expect(await first.next()).toEqual({ kind: "heartbeat" });
    expect(scheduler.active()).toBe(3);

    for (const controller of controllers) controller.abort();
    expect(scheduler.active()).toBe(0);
    expect(events.streamCount).toBe(0);
  });

  it("wakes a waiting stream on abort and detaches it immediately", async () => {
    const scheduler = fakeScheduler();
    const events = await service({ scheduler });
    const controller = new AbortController();
    const added = spyOn(controller.signal, "addEventListener");
    const removed = spyOn(controller.signal, "removeEventListener");
    const stream = events.open(controller.signal);
    const waiting = stream.next();

    controller.abort();

    expect(await waiting).toBeUndefined();
    expect(stream.isClosed).toBe(true);
    expect(events.streamCount).toBe(0);
    expect(scheduler.active()).toBe(0);
    expect(added).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledTimes(1);
    await events.publishAsync("late");
    expect(await stream.next()).toBeUndefined();
  });

  it("closes a stream opened with an already aborted signal", async () => {
    const scheduler = fakeScheduler();
    const events = await service({ scheduler });
    const controller = new AbortController();
    controller.abort();
    const stream = events.open(controller.signal);
    expect(await stream.next()).toBeUndefined();
    expect(events.streamCount).toBe(0);
    expect(scheduler.active()).toBe(0);
  });

  it("closes every stream when the service closes", async () => {
    const scheduler = fakeScheduler();
    const events = await service({ scheduler });
    const stream = events.open(new AbortController().signal);
    await events.close();
    expect(await stream.next()).toBeUndefined();
    expect(scheduler.active()).toBe(0);
  });
});

describe("SSE wire format", () => {
  it("encodes data events as default messages and control frames separately", () => {
    expect(encodeFrame({ kind: "event", id: "7", data: '{"type":"t"}' })).toBe(
      'id: 7\ndata: {"type":"t"}\n\n',
    );
    expect(encodeFrame({ kind: "resync" })).toBe("event: resync\ndata: {}\n\n");
    expect(encodeFrame({ kind: "heartbeat" })).toBe(": heartbeat\n\n");
  });

  it("streams a retry hint first and releases the stream when the body is cancelled", async () => {
    const events = await service({ retryMs: 1_500 });
    const stream = events.open(new AbortController().signal);
    const response = eventStreamResponse(stream, events.retryMs);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("missing body");
    const decoder = new TextDecoder();

    expect(decoder.decode((await reader.read()).value)).toBe("retry: 1500\n\n");
    await events.publishAsync({ message: "line\nbreak" });
    expect(decoder.decode((await reader.read()).value)).toBe(
      'id: 1\ndata: {"message":"line\\nbreak"}\n\n',
    );

    await reader.cancel();
    expect(stream.isClosed).toBe(true);
    expect(events.streamCount).toBe(0);
  });
});
