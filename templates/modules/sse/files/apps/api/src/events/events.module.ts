import { AppException } from "@podosoft/podokit-contracts";
import { EVENTS } from "@podosoft/podokit-runtime";
import { Elysia, sse, t } from "elysia";
import {
  type AppPlugin,
  type PodokitModule,
  READINESS,
} from "../core/services";
import { EventsService } from "./events.service";

export const SSE_EVENTS = Symbol("sse-events") as import("../core/services").ServiceKey<EventsService>;

const eventsPlugin: AppPlugin = ({ services }) => {
  const events = services.resolve(SSE_EVENTS);
  return new Elysia({ name: "podokit.events" })
    .get("/events/stream", async function* ({ request }) {
      for await (const data of events.stream(request.signal)) yield sse({ data });
    }, {
      detail: { tags: ["events"], summary: "Stream server-sent events" },
    })
    .post("/events", async ({ body, set }) => {
      try {
        await events.publishAsync({ type: "message", message: body.message });
      } catch {
        throw new AppException(
          "EVENTS_TRANSPORT_UNAVAILABLE",
          "Event transport is unavailable",
          503,
        );
      }
      set.status = 201;
      return { ok: true as const };
    }, {
      body: t.Object({ message: t.String() }),
      detail: { tags: ["events"], summary: "Publish an event" },
    });
};

export const eventsModule: PodokitModule = {
  name: "sse",
  configure: (_env, services): void => {
    const events = new EventsService(services.resolve(EVENTS), services.resolve(READINESS));
    services.register(SSE_EVENTS, events, () => events.close());
    services.onStart(() => events.connect());
  },
  plugin: eventsPlugin,
};
