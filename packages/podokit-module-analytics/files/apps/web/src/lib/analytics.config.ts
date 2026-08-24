import type { AnalyticsAppConfig } from "#lib/analytics.js";

const excludedPathPrefixes = [
  "/admin",
  "/account",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/setup-2fa",
  "/pending-approval",
  "/maintenance",
] as const;

/** Application-owned analytics routing policy. Return null from mapPath to
 * exclude a sensitive route, or replace dynamic identifiers with a stable
 * logical path before it is sent. Query strings and fragments are stripped by
 * the managed runtime before this function runs. */
export const analyticsAppConfig: AnalyticsAppConfig = {
  excludedPathPrefixes,
  mapPath: (pathname: string): string | null => pathname,
};
