import { Injectable, type OnModuleInit } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";
import { EventsService } from "../events/events.service";
import { PROGRESS_CHANNEL } from "./progress.processor";

// Runs in the API process: relays worker progress (Redis pub/sub) to SSE.
@Injectable()
export class ProgressBridge implements OnModuleInit {
  constructor(
    private readonly redis: RedisService,
    private readonly events: EventsService,
  ) {}

  onModuleInit(): void {
    this.redis.subscribe(PROGRESS_CHANNEL, (message) => {
      this.events.publish({ type: "job-progress", ...JSON.parse(message) });
    });
  }
}
