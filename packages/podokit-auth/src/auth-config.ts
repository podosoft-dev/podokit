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
  return {
    version: "env",
    social,
    requireEmailVerification: process.env.AUTH_EMAIL_VERIFICATION === "true",
    requireSignupApproval: process.env.AUTH_REQUIRE_SIGNUP_APPROVAL === "true",
    allowDelete: process.env.AUTH_ALLOW_DELETE === "true",
    hibp: process.env.AUTH_HIBP === "true",
    auditLog: process.env.AUDIT_LOG_ENABLED === "true",
  };
}
