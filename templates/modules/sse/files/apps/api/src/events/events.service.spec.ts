import { describe, expect, it } from "bun:test";
import { ReadinessService } from "../health/readiness.service";
import { MemoryEventBus } from "@podosoft/podokit-runtime";
import { EventsService } from "./events.service";

describe("EventsService", () => {
  it("publishes through the transport and delivers locally", async () => {
    const readiness = new ReadinessService();
    const service = new EventsService(new MemoryEventBus(), readiness);
    const received: unknown[] = [];
    service.subscribe((data) => received.push(data));
    await service.connect();
    await service.publishAsync({ type: "changed" });
    expect(received).toEqual([{ type: "changed" }]);
    await expect(readiness.run()).resolves.toEqual({ events: "up" });
    await service.close();
  });

  it("rejects events larger than the configured limit", async () => {
    const service = new EventsService(
      new MemoryEventBus({ maxEventBytes: 8 }),
      new ReadinessService(),
    );
    await service.connect();
    await expect(service.publishAsync({ message: "too large" })).rejects.toThrow(
      "Event exceeds maxEventBytes",
    );
    await service.close();
  });
});
