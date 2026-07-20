/**
 * @podosoft/podokit-auth — PodoKit's DB-backed auth configuration pipeline
 * (envelope-encrypted secrets, the AuthConfig model, and a config store) that
 * sits on top of better-auth. Kept free of better-auth and Nest/TypeORM imports
 * so it can be loaded outside DI and by the better-auth CLI during migrations.
 */
export { encryptSecret, decryptSecret } from "./secret";
export {
  type OAuthProviderConfig,
  type AuthConfig,
  SUPPORTED_SOCIAL_PROVIDERS,
  SUPPORTED_PROVIDER_IDS,
  DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES,
  MIN_SESSION_IDLE_TIMEOUT_MINUTES,
  MAX_SESSION_IDLE_TIMEOUT_MINUTES,
  DEFAULT_SESSION_LIFETIME_SECONDS,
  type SessionIdleOptions,
  isSessionIdleTimeoutMinutes,
  resolveSessionIdleTimeoutMinutes,
  sessionIdleOptions,
  socialKey,
  envAuthConfig,
} from "./auth-config";
export { type SmtpConfig, createConfigStore } from "./config-store";
