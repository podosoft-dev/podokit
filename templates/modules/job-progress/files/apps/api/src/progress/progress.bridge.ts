import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { RedisService } from "../redis/redis.service";
import { EventsService } from "../events/events.service";
import { PROGRESS_CHANNEL } from "./progress.processor";

// Runs in the API process: relays worker progress (Redis pub/sub) to SSE.
@Injectable()
export class ProgressBridge implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProgressBridge.name);
  private unsubscribe?: () => Promise<void>;

  constructor(
    private readonly redis: RedisService,
    private readonly events: EventsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.unsubscribe = await this.redis.subscribe(PROGRESS_CHANNEL, (message) => {
      try {
        const parsed: unknown = JSON.parse(message);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          this.logger.warn("Discarded invalid job progress event");
          return;
        }
        this.events.publishLocal({ type: "job-progress", ...parsed });
      } catch {
        this.logger.warn("Discarded malformed job progress event");
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.unsubscribe?.();
  }
}
