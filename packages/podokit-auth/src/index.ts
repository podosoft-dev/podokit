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
  type AuthConfigDefaults,
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
  DEFAULT_AUTH_APP_NAME,
  envAppName,
  envAuthConfig,
} from "./auth-config";
export {
  type AppSettingRow,
  type AuthConfigQueryClient,
  type AuthConfigRepository,
  type AuthConfigRow,
  type CapabilitiesSnapshot,
  type ConfigStore,
  type ConfigStoreOptions,
  type ConfigVersions,
  type SmtpConfig,
  createConfigStore,
  createQueryAuthConfigRepository,
} from "./config-store";
