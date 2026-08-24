import { Elysia, t } from "elysia";
import { AUDIT } from "../audit/audit.module";
import { AUTH } from "../auth/auth.module";
import {
  ACCESS_POLICY,
  DATABASE,
  type AppPlugin,
  type PodokitModule,
  type ServiceKey,
} from "../core/services";
import {
  AnalyticsService,
  type UpdateAnalyticsConfig,
} from "./analytics.service";

export const ANALYTICS = Symbol("analytics") as ServiceKey<AnalyticsService>;

const updateSchema = t.Object({
  enabled: t.Optional(t.Boolean()),
  provider: t.Optional(t.Literal("ga4")),
  measurementId: t.Optional(t.String({ pattern: "^G-[A-Z0-9]{4,30}$" })),
  propertyId: t.Optional(t.String({ pattern: "^[0-9]{1,30}$" })),
  serviceAccountJson: t.Optional(t.String({ maxLength: 32_768 })),
});
const reportSchema = t.Object({
  from: t.Optional(t.String({ format: "date" })),
  to: t.Optional(t.String({ format: "date" })),
});

const analyticsPlugin: AppPlugin = ({ services }) => {
  const analytics = services.resolve(ANALYTICS);
  const auth = services.resolve(AUTH);
  const audit = services.resolve(AUDIT);

  return new Elysia({ name: "podokit.analytics" })
    .get("/analytics/config", () => analytics.publicConfig(), {
      detail: { tags: ["analytics"], summary: "Get the public analytics configuration" },
    })
    .get("/admin/analytics/config", async ({ request }) => {
      await auth.requireAdmin(request);
      return analytics.adminConfig();
    }, {
      detail: { tags: ["analytics"], summary: "Get the analytics configuration" },
    })
    .put("/admin/analytics/config", async ({ request, body }) => {
      const session = await auth.requireAdmin(request);
      const result = await analytics.update(body as UpdateAnalyticsConfig);
      await audit.recordRequest("analytics.config.update", request, session, {
        type: "analytics-config",
        id: "default",
      });
      return result;
    }, {
      body: updateSchema,
      detail: { tags: ["analytics"], summary: "Update the analytics configuration" },
    })
    .delete("/admin/analytics/config/credentials", async ({ request }) => {
      const session = await auth.requireAdmin(request);
      const result = await analytics.deleteCredentials();
      await audit.recordRequest("analytics.credentials.delete", request, session, {
        type: "analytics-config",
        id: "default",
      });
      return result;
    }, {
      detail: { tags: ["analytics"], summary: "Delete stored analytics credentials" },
    })
    .post("/admin/analytics/config/test", async ({ request, set }) => {
      const session = await auth.requireAdmin(request);
      const result = await analytics.verify();
      await audit.recordRequest("analytics.connection.verify", request, session, {
        type: "analytics-config",
        id: "default",
      });
      set.status = 201;
      return result;
    }, {
      detail: { tags: ["analytics"], summary: "Verify the analytics connection" },
    })
    .get("/admin/analytics/report", async ({ request, query }) => {
      await auth.requireAdmin(request);
      return analytics.report(query.from, query.to);
    }, {
      query: reportSchema,
      detail: { tags: ["analytics"], summary: "Get an aggregate analytics report" },
    })
    .get("/admin/analytics/realtime", async ({ request }) => {
      await auth.requireAdmin(request);
      return analytics.realtime();
    }, {
      detail: { tags: ["analytics"], summary: "Get realtime analytics" },
    });
};

export const analyticsModule: PodokitModule = {
  name: "analytics",
  configure: (_env, services): void => {
    services.register(ANALYTICS, new AnalyticsService(services.resolve(DATABASE).sql));
    services.resolve(ACCESS_POLICY).register("GET", "/analytics/config", "public");
  },
  plugin: analyticsPlugin,
};
