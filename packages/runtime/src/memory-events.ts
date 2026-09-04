import type { EventBus, EventHandler, Unsubscribe } from "./contracts";

export interface MemoryEventBusOptions {
  maxEventBytes?: number;
}

function cloneEvent(event: unknown, maximumBytes: number): unknown {
  const encoded = JSON.stringify(event);
  if (encoded === undefined) throw new Error("Event must be JSON serializable");
  if (Buffer.byteLength(encoded, "utf8") > maximumBytes) {
    throw new Error(`Event exceeds maxEventBytes (${maximumBytes})`);
  }
  return JSON.parse(encoded) as unknown;
}

export class MemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly maxEventBytes: number;

  constructor(options: MemoryEventBusOptions = {}) {
    const maxEventBytes = options.maxEventBytes ?? 65_536;
    if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes < 1) {
      throw new Error("maxEventBytes must be a positive integer");
    }
    this.maxEventBytes = maxEventBytes;
  }

  ready(): Promise<void> {
    return Promise.resolve();
  }

  async publish(topic: string, event: unknown): Promise<void> {
    const handlers = [...(this.handlers.get(topic) ?? [])];
    const cloned = cloneEvent(event, this.maxEventBytes);
    await Promise.all(handlers.map((handler) => handler(cloned)));
  }

  subscribe(topic: string, handler: EventHandler): Promise<Unsubscribe> {
    const handlers = this.handlers.get(topic) ?? new Set<EventHandler>();
    handlers.add(handler);
    this.handlers.set(topic, handlers);
    return Promise.resolve(() => {
      handlers.delete(handler);
      if (handlers.size === 0) this.handlers.delete(topic);
    });
  }

  close(): void {
    this.handlers.clear();
  }
}
