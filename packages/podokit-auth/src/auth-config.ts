// Shape of the runtime-resolvable auth configuration. Kept free of Nest/TypeORM
// imports so auth.ts (loaded outside DI, and by the better-auth CLI during
// migrations) can import it. Values come from the DB (auth_config table) when set,
// falling back to environment variables field-by-field (see config-store.ts).

export type OAuthProviderConfig = {
  enabled: boolean;
  clientId: string;
  clientSecret: string; // already decrypted by the store; never persisted in plaintext
  redirectURI?: string;
};

// Social providers admins can add from the Settings page. These are the OAuth
// providers better-auth supports out of the box with a client id + secret (the
// registry in @better-auth/core/social-providers). buildSocial() only registers
// ids in this allowlist, so an unknown/unsupported key can never reach
// betterAuth() and break instance construction.
export const SUPPORTED_SOCIAL_PROVIDERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "apple", label: "Apple" },
  { id: "microsoft", label: "Microsoft" },
  { id: "facebook", label: "Facebook" },
  { id: "discord", label: "Discord" },
  { id: "gitlab", label: "GitLab" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "twitch", label: "Twitch" },
  { id: "spotify", label: "Spotify" },
  { id: "dropbox", label: "Dropbox" },
  { id: "kakao", label: "Kakao" },
  { id: "naver", label: "Naver" },
  { id: "line", label: "LINE" },
  { id: "slack", label: "Slack" },
  { id: "notion", label: "Notion" },
  { id: "twitter", label: "X (Twitter)" },
  { id: "tiktok", label: "TikTok" },
  { id: "reddit", label: "Reddit" },
  { id: "zoom", label: "Zoom" },
  { id: "figma", label: "Figma" },
  { id: "salesforce", label: "Salesforce" },
  { id: "atlassian", label: "Atlassian" },
  { id: "kick", label: "Kick" },
];

export const SUPPORTED_PROVIDER_IDS = new Set(SUPPORTED_SOCIAL_PROVIDERS.map((p) => p.id));

/** Default value offered when an administrator enables automatic logout. */
export const DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES = 30;
/** Smallest accepted idle timeout. Shorter values create excessive refresh traffic. */
export const MIN_SESSION_IDLE_TIMEOUT_MINUTES = 5;
/** Largest accepted idle timeout (seven days, matching better-auth's default session lifetime). */
export const MAX_SESSION_IDLE_TIMEOUT_MINUTES = 7 * 24 * 60;
/** better-auth's default session lifetime, used when the custom policy is disabled. */
export const DEFAULT_SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export type SessionIdleOptions = { expiresIn: number; updateAge: number };

/** Narrow an API/DB value to a supported timeout. `null` explicitly disables the policy. */
export function isSessionIdleTimeoutMinutes(value: unknown): value is number | null {
  return value === null || (
    typeof value === "number"
    && Number.isInteger(value)
    && value >= MIN_SESSION_IDLE_TIMEOUT_MINUTES
    && value <= MAX_SESSION_IDLE_TIMEOUT_MINUTES
  );
}

/** Resolve an optional DB value without letting malformed persisted data break auth startup. */
export function resolveSessionIdleTimeoutMinutes(
  value: unknown,
  fallback: number | null,
): number | null {
  return isSessionIdleTimeoutMinutes(value) ? value : fallback;
}

/** Translate the admin policy into better-auth's sliding session-expiry options. */
export function sessionIdleOptions(minutes: number | null): SessionIdleOptions | undefined {
  if (minutes === null) return undefined;
  return {
    expiresIn: minutes * 60,
    // Refresh at most once a minute so active sessions slide forward without a
    // database write on every authenticated request.
    updateAge: Math.min(60, Math.floor((minutes * 60) / 2)),
  };
}

/** Config row key for a social provider (e.g. "social.google"). */
export const socialKey = (id: string): string => `social.${id}`;

export type AuthConfig = {
  /** Opaque version token; changes when config changes so the auth instance rebuilds.
   *  "env" means "no DB rows — using environment fallback" (identical to legacy behavior). */
  version: string;
  /** Configured social providers, keyed by provider id (google, github, apple, …).
   *  Dynamic: admins add/edit/remove providers from the Settings page. */
  social: Record<string, OAuthProviderConfig>;
  /** Require new sign-ups to verify their email before signing in. */
  requireEmailVerification: boolean;
  /** Require an administrator to approve newly self-registered users. */
  requireSignupApproval: boolean;
  /** Allow users to delete their own account. */
  allowDelete: boolean;
  /** Reject passwords found in known breaches (Have I Been Pwned). */
  hibp: boolean;
  /** Record security-relevant actions to the audit_logs table (audit-log module). */
  auditLog: boolean;
  /** End an inactive session after this many minutes; null preserves the default lifetime. */
  sessionIdleTimeoutMinutes: number | null;
};

/** Build the config purely from environment variables — the backward-compatible
 *  default when the auth_config table is empty, and the boot-time bootstrap. Only
 *  Google/GitHub have env fallbacks (the historical env vars); other providers are
 *  DB-only. */
export function envAuthConfig(): AuthConfig {
  const social: Record<string, OAuthProviderConfig> = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    social.google = { enabled: true, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
  }
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    social.github = { enabled: true, clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET };
  }
  const configuredIdleTimeout = Number(process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES);
  const sessionIdleTimeoutMinutes = process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES === undefined
    ? null
    : resolveSessionIdleTimeoutMinutes(configuredIdleTimeout, null);
  return {
    version: "env",
    social,
    requireEmailVerification: process.env.AUTH_EMAIL_VERIFICATION === "true",
    requireSignupApproval: process.env.AUTH_REQUIRE_SIGNUP_APPROVAL === "true",
    allowDelete: process.env.AUTH_ALLOW_DELETE === "true",
    hibp: process.env.AUTH_HIBP === "true",
    auditLog: process.env.AUDIT_LOG_ENABLED === "true",
    sessionIdleTimeoutMinutes,
  };
}
