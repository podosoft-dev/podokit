import { describe, expect, it, mock } from "bun:test";
import type { EventsService } from "../events/events.service";
import type { RedisService } from "../redis/redis.service";
import { ProgressBridge } from "./progress.bridge";
import { PROGRESS_CHANNEL } from "./progress.processor";

describe("ProgressBridge", () => {
  it("delivers worker fan-out locally without republishing it", async () => {
    let handler: ((message: string) => void) | undefined;
    const unsubscribe = mock<() => Promise<void>>(() => Promise.resolve());
    const subscribe = mock(
      (channel: string, listener: (message: string) => void): Promise<() => Promise<void>> => {
        expect(channel).toBe(PROGRESS_CHANNEL);
        handler = listener;
        return Promise.resolve(unsubscribe);
      },
    );
    const publishLocal = mock<(data: unknown) => void>();
    const redis = { subscribe } as unknown as RedisService;
    const events = { publishLocal } as unknown as EventsService;
    const bridge = new ProgressBridge(redis, events);

    await bridge.connect();
    handler?.('{"jobId":"1","progress":50}');
    handler?.("invalid");

    expect(publishLocal).toHaveBeenCalledTimes(1);
    expect(publishLocal).toHaveBeenCalledWith({
      type: "job-progress",
      jobId: "1",
      progress: 50,
    });
    await bridge.close();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
