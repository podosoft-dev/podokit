import { Elysia } from "elysia";
import { AUTH } from "../auth/auth.module";
import {
  DATABASE,
  type AppPlugin,
  type PodokitModule,
  type ServiceKey,
} from "../core/services";
import { auditEnabled } from "./audit-enabled";
import { AuditService } from "./audit.service";

export const AUDIT = Symbol("audit") as ServiceKey<AuditService>;

const auditPlugin: AppPlugin = ({ services }) => {
  const auth = services.resolve(AUTH);
  const audit = services.resolve(AUDIT);
  return new Elysia({ name: "podokit.audit" })
    .get("/audit-logs", async ({ request }) => {
      await auth.requireAdmin(request);
      return audit.recent();
    }, {
      detail: { tags: ["audit"], summary: "List recent audit entries" },
    });
};

export const auditModule: PodokitModule = {
  name: "audit-log",
  configure: (_env, services): void => {
    const database = services.resolve(DATABASE);
    const audit = new AuditService(database.sql, { dialect: database.provider, enabled: auditEnabled });
    services.register(AUDIT, audit, () => audit.close());
    services.onStart(() => audit.connect());
  },
  plugin: auditPlugin,
};
