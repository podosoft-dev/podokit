import type { EventBus, Unsubscribe } from "@podosoft/podokit-runtime";
import { ReadinessService } from "../health/readiness.service";
import {
  EventStream,
  timerScheduler,
  type EventStreamOptions,
  type Scheduler,
} from "./event-stream";

type LocalHandler = (data: unknown) => void;

export interface EventsServiceOptions {
  /** Events buffered for one slow client before it is told to resync. */
  queueLimit?: number;
  heartbeatMs?: number;
  /** Reconnect delay the stream advertises to EventSource clients. */
  retryMs?: number;
  scheduler?: Scheduler;
}

export class EventsService {
  readonly retryMs: number;
  private readonly streamOptions: EventStreamOptions;
  private readonly handlers = new Set<LocalHandler>();
  private readonly streams = new Set<EventStream>();
  private unregisterReadiness?: () => void;
  private unsubscribe?: Unsubscribe;

  constructor(
    private readonly transport: EventBus,
    private readonly readiness: ReadinessService,
    options: EventsServiceOptions = {},
  ) {
    this.retryMs = options.retryMs ?? 3_000;
    this.streamOptions = {
      queueLimit: options.queueLimit ?? 256,
      heartbeatMs: options.heartbeatMs ?? 5_000,
      scheduler: options.scheduler ?? timerScheduler,
    };
  }

  get streamCount(): number {
    return this.streams.size;
  }

  async connect(): Promise<void> {
    this.unsubscribe = await this.transport.subscribe("sse", (data) => this.publishLocal(data));
    this.unregisterReadiness = this.readiness.register("events", () => this.transport.ready());
  }

  publish(data: unknown): void {
    void this.publishAsync(data).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Publish event failed: ${message}\n`);
    });
  }

  publishAsync(data: unknown): Promise<void> {
    return this.transport.publish("sse", data);
  }

  publishLocal(data: unknown): void {
    for (const handler of this.handlers) handler(data);
    if (this.streams.size === 0) return;
    const payload = JSON.stringify(data) ?? "null";
    for (const stream of this.streams) stream.offer(payload, undefined);
  }

  subscribe(handler: LocalHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  open(signal: AbortSignal): EventStream {
    const stream = new EventStream(this.streamOptions, (closed) => this.streams.delete(closed));
    this.streams.add(stream);
    stream.start(signal);
    return stream;
  }

  async close(): Promise<void> {
    this.unregisterReadiness?.();
    await this.unsubscribe?.();
    this.handlers.clear();
    for (const stream of [...this.streams]) stream.close();
  }
}
