import { Injectable, type MessageEvent } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

@Injectable()
export class EventsService {
  private readonly subject = new Subject<MessageEvent>();

  // Push an event to all connected clients. Inject this service anywhere
  // (e.g. a queue processor) to broadcast progress or notifications.
  publish(data: unknown): void {
    this.subject.next({ data } as MessageEvent);
  }

  asObservable(): Observable<MessageEvent> {
    return this.subject.asObservable();
  }
}
