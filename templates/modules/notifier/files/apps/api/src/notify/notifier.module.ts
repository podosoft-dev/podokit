import { AppException } from "@podosoft/podokit-contracts";
import { Elysia, t } from "elysia";
import {
  DATABASE,
  LOGGER,
  REQUEST_IDENTITY,
  type AppPlugin,
  type ElysiaPlugin,
  type PodokitModule,
  type RequestIdentity,
  type ServiceKey,
} from "../core/services";
import { NotifierSettings, type NotifierUpdate } from "./notifier-config";
import { notifyOperators, setNotifierConfigSource, setNotifierLogger, type NotifyResult } from "./notifier";

export const NOTIFIER_SETTINGS = Symbol("notifier-settings") as ServiceKey<NotifierSettings>;

const secretSchema = t.Optional(t.Nullable(t.String({ maxLength: 512 })));
const updateSchema = t.Object({
  pushover: t.Optional(t.Object({
    enabled: t.Optional(t.Boolean()),
    token: secretSchema,
    userKey: secretSchema,
  }, { additionalProperties: false })),
  email: t.Optional(t.Object({
    enabled: t.Optional(t.Boolean()),
    recipients: t.Optional(t.Array(t.String({ maxLength: 320 }), { maxItems: 20 })),
  }, { additionalProperties: false })),
  webhook: t.Optional(t.Object({
    enabled: t.Optional(t.Boolean()),
    url: t.Optional(t.Nullable(t.String({ maxLength: 2048 }))),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

async function requireAdmin(identity: RequestIdentity, request: Request): Promise<void> {
  if (!(await identity.userId(request))) {
    throw new AppException("AUTH_REQUIRED", "Authentication is required", 401);
  }
  if (!(await identity.isAdmin(request))) {
    throw new AppException("ADMIN_REQUIRED", "Administrator access is required", 403);
  }
}

export function notifierRoutes(
  settings: NotifierSettings,
  identity: RequestIdentity,
  send: () => Promise<NotifyResult> = () => notifyOperators({
    title: "Test notification",
    message: "Operator notifications are working. This is a test sent from the admin Settings page.",
    priority: 0,
  }),
): ElysiaPlugin {
  return new Elysia({ name: "podokit.notifier" })
    .get("/admin/notifier/config", async ({ request }) => {
      await requireAdmin(identity, request);
      return settings.describe();
    }, {
      detail: {
        tags: ["notifier"],
        summary: "Get the operator notification settings",
        description: "Administrators only. Secrets are reported as hasToken, hasUserKey, and hasUrl booleans.",
      },
    })
    .put("/admin/notifier/config", async ({ request, body }) => {
      await requireAdmin(identity, request);
      return settings.update(body as NotifierUpdate);
    }, {
      body: updateSchema,
      detail: {
        tags: ["notifier"],
        summary: "Update the operator notification settings",
        description: "Administrators only. Applies without a restart. A secret set to null is removed so its " +
          "environment variable applies again; an empty or absent secret keeps the stored value.",
      },
    })
    .post("/admin/notifier/test", async ({ request }) => {
      await requireAdmin(identity, request);
      settings.invalidate();
      return send();
    }, {
      detail: {
        tags: ["notifier"],
        summary: "Send a test operator notification",
        description: "Administrators only. Sends a fixed message to every enabled channel and returns each channel's result.",
      },
    });
}

const notifierPlugin: AppPlugin = ({ services }) =>
  notifierRoutes(services.resolve(NOTIFIER_SETTINGS), services.resolve(REQUEST_IDENTITY));

export const notifierModule: PodokitModule = {
  name: "notifier",
  configure: (_env, services): void => {
    const database = services.resolve(DATABASE);
    // Resolved on use: a module such as logging may replace the logger later.
    const warn = (meta: Record<string, unknown>, message: string): void => {
      services.resolve(LOGGER).warn(meta, message);
    };
    const settings = new NotifierSettings(database.sql, database.provider, process.env, (key) => {
      warn({ key }, "Decrypt operator notification secret failed; check BETTER_AUTH_SECRET");
    });
    services.register(NOTIFIER_SETTINGS, settings);
    setNotifierConfigSource(() => settings.config());
    setNotifierLogger({ warn });
  },
  plugin: notifierPlugin,
};
