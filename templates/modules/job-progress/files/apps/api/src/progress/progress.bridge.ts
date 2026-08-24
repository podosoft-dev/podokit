import { RedisService } from "../redis/redis.service";
import { EventsService } from "../events/events.service";
import { PROGRESS_CHANNEL } from "./progress.processor";

// Runs in the API process: relays worker progress (Redis pub/sub) to SSE.
export class ProgressBridge {
  private unsubscribe?: () => Promise<void>;

  constructor(
    private readonly redis: RedisService,
    private readonly events: EventsService,
  ) {}

  async connect(): Promise<void> {
    this.unsubscribe = await this.redis.subscribe(PROGRESS_CHANNEL, (message) => {
      try {
        const parsed: unknown = JSON.parse(message);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          process.stderr.write("Discard invalid job progress event\n");
          return;
        }
        this.events.publishLocal({ type: "job-progress", ...parsed });
      } catch {
        process.stderr.write("Discard malformed job progress event\n");
      }
    });
  }

  async close(): Promise<void> {
    await this.unsubscribe?.();
  }
}
