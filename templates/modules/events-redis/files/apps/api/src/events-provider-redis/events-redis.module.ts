import { EVENTS } from "@podosoft/podokit-runtime";
import type { PodokitModule } from "../core/services";
import { PROVIDERS } from "../config/providers";
import { READINESS } from "../core/services";
import { RedisEventBus } from "./redis-event.bus";

export const eventsRedisModule: PodokitModule = {
  name: "events-redis",
  configure: (_env, services): void => {
    if (PROVIDERS.events !== "redis") return;
    const events = new RedisEventBus();
    const unregister = services.resolve(READINESS).register("events", () => events.ready());
    services.register(EVENTS, events, async () => {
      unregister();
      await events.close();
    });
    services.onStart(() => events.ready());
  },
};
