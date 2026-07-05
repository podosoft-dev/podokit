import { Body, Controller, Post, Sse, type MessageEvent } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { interval, map, merge, type Observable } from "rxjs";
import { EventsService } from "./events.service";
import { PublishEventDto } from "./dto/publish-event.dto";

@ApiTags("events")
@Controller("events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Sse("stream")
  stream(): Observable<MessageEvent> {
    const heartbeat = interval(5000).pipe(
      map((n): MessageEvent => ({ data: { type: "heartbeat", n } })),
    );
    return merge(this.events.asObservable(), heartbeat);
  }

  @Post()
  publish(@Body() dto: PublishEventDto): { ok: true } {
    this.events.publish({ type: "message", message: dto.message });
    return { ok: true };
  }
}
