import { APIError, createAuthMiddleware } from "better-auth/api";
import type { Pool } from "pg";
import { FLAG_DEFAULTS, type FeatureFlag } from "../settings/flag-defaults";

/** Auth-relative path prefixes owned by each admin-toggleable feature. A path is
 *  gated when it equals a prefix or starts with a prefix ending in "/". */
const FEATURE_PATHS: Array<{ flag: FeatureFlag; prefixes: string[] }> = [
  { flag: "twoFactor", prefixes: ["/two-factor/"] },
  { flag: "magicLink", prefixes: ["/sign-in/magic-link", "/magic-link/"] },
  { flag: "emailOtp", prefixes: ["/email-otp/", "/sign-in/email-otp"] },
  { flag: "username", prefixes: ["/sign-in/username"] },
  { flag: "multiSession", prefixes: ["/multi-session/"] },
  { flag: "phoneNumber", prefixes: ["/phone-number/", "/sign-in/phone-number"] },
  { flag: "apiKey", prefixes: ["/api-key/"] },
  { flag: "passkey", prefixes: ["/passkey/", "/sign-in/passkey"] },
  { flag: "organization", prefixes: ["/organization"] },
  { flag: "oidcProvider", prefixes: ["/oauth2/", "/.well-known/openid-configuration"] },
];

const CACHE_TTL_MS = 3_000;

/** Server-side enforcement for the admin Settings toggles: requests to a disabled
 *  feature's endpoints are rejected with 404, so "off" is a real boundary rather
 *  than hidden UI. Flags are read from app_setting through a small TTL cache
 *  (a toggle takes effect within ~CACHE_TTL_MS); before the migration has run,
 *  the shipped defaults apply. */
export function createFeatureGate(pool: Pool) {
  let cache: Record<FeatureFlag, boolean> = { ...FLAG_DEFAULTS };
  let fetchedAt = 0;

  async function flags(): Promise<Record<FeatureFlag, boolean>> {
    if (Date.now() - fetchedAt < CACHE_TTL_MS) return cache;
    try {
      const res = await pool.query<{ key: string; value: string }>(
        'SELECT "key", "value" FROM "app_setting" WHERE "key" = ANY($1)',
        [Object.keys(FLAG_DEFAULTS)],
      );
      const next = { ...FLAG_DEFAULTS };
      for (const row of res.rows) next[row.key as FeatureFlag] = row.value === "true";
      cache = next;
    } catch {
      cache = { ...FLAG_DEFAULTS };
    }
    fetchedAt = Date.now();
    return cache;
  }

  return createAuthMiddleware(async (ctx) => {
    const feature = FEATURE_PATHS.find((f) =>
      f.prefixes.some((p) => ctx.path === p || ctx.path.startsWith(p)),
    );
    if (!feature) return;
    const enabled = (await flags())[feature.flag];
    if (!enabled) throw new APIError("NOT_FOUND", { message: "This feature is disabled." });
  });
}
