import { createAuthClient } from "better-auth/client";
import { adminClient, twoFactorClient, magicLinkClient, emailOTPClient, usernameClient, multiSessionClient, phoneNumberClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";

/** Options for {@link createApiClient}. */
export interface ApiClientOptions {
  /** Origin of the API. Empty string for same-origin (browser through a proxy);
   *  an absolute URL (e.g. the internal backend URL) for server-side use.
   *  The better-auth client needs an absolute origin, so in the browser an
   *  empty value falls back to `location.origin`. */
  baseUrl?: string;
  /** Path prefix for the app's REST endpoints. Default `/api`. */
  apiBasePath?: string;
  /** Custom fetch (inject on the server to forward cookies for SSR). */
  fetch?: typeof globalThis.fetch;
  /** Credentials mode for requests. Default `include` (send cookies). */
  credentials?: RequestCredentials;
}

/**
 * Feature flags the API reports at `GET /account/capabilities`. The web app gates
 * optional auth features (2FA, social providers, account deletion, ...) on these
 * so UI never offers an endpoint the server didn't enable. Single source of truth
 * for the shape — the backend controller and every SvelteKit loader import it.
 */
export interface Capabilities {
  twoFactor: boolean;
  providers: string[];
  deleteAccount: boolean;
  auditLog: boolean;
  emailVerification: boolean;
  /** Reject passwords found in known breaches (Have I Been Pwned) on sign-up/change. */
  passwordBreachCheck: boolean;
  /** Passwordless sign-in via an emailed magic link. */
  magicLink: boolean;
  /** Passwordless sign-in via an emailed one-time code. */
  emailOtp: boolean;
  /** Sign in with a username instead of an email. */
  username: boolean;
  /** Hold several signed-in accounts in one browser and switch between them. */
  multiSession: boolean;
  /** Register and verify a phone number (SMS OTP). */
  phoneNumber: boolean;
  /** Issue and manage personal API keys. */
  apiKey: boolean;
  /** Register passkeys (WebAuthn) for passwordless sign-in. */
  passkey: boolean;
  /** Assignable role names (access-control). */
  roles: string[];
}

/** Error thrown when the API returns the standard error envelope or a non-2xx status. */
export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function toApiError(data: unknown, response: Response): ApiError {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error: unknown }).error;
    if (error && typeof error === "object") {
      const record = error as Record<string, unknown>;
      return new ApiError(
        typeof record.code === "string" ? record.code : "HTTP_ERROR",
        typeof record.message === "string" ? record.message : response.statusText,
        typeof record.statusCode === "number" ? record.statusCode : response.status,
        record.details,
      );
    }
  }
  return new ApiError("HTTP_ERROR", response.statusText || "Request failed", response.status);
}

/**
 * Create a typed API client. Every frontend talks to the PodoKit backend
 * through this single entry point — never with a raw fetch.
 *
 * - `client.auth` is the better-auth client (email/password, sessions, and the
 *   admin plugin: `client.auth.admin.listUsers()`, `banUser`, `setRole`, ...).
 * - `client.get/post/put/patch/del` call the app's REST endpoints and parse the
 *   standard error envelope, throwing {@link ApiError} on failure.
 */
export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const apiBasePath = options.apiBasePath ?? "/api";
  const credentials = options.credentials ?? "include";
  const doFetch = options.fetch ?? globalThis.fetch;

  // better-auth mounts at /api/auth and needs an absolute origin. In the
  // browser an empty baseUrl resolves to the current origin.
  const authOrigin =
    options.baseUrl ?? (typeof globalThis.location === "undefined" ? "" : globalThis.location.origin);

  // Inner factory so the return type keeps the admin plugin's client methods
  // (a bare ReturnType<typeof createAuthClient> would drop the plugin augmentation).
  const makeAuthClient = () =>
    createAuthClient({
      baseURL: authOrigin,
      plugins: [adminClient(), twoFactorClient(), magicLinkClient(), emailOTPClient(), usernameClient(), multiSessionClient(), phoneNumberClient(), apiKeyClient(), passkeyClient()],
      fetchOptions: {
        credentials,
        ...(options.fetch ? { customFetchImpl: options.fetch } : {}),
      },
    });

  // Created lazily: REST-only usage (and SSR without an origin) never triggers
  // the better-auth client's eager URL validation.
  let authClient: ReturnType<typeof makeAuthClient> | undefined;
  function getAuth(): ReturnType<typeof makeAuthClient> {
    authClient ??= makeAuthClient();
    return authClient;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await doFetch(`${baseUrl}${apiBasePath}${path}`, {
      method,
      credentials,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      throw toApiError(data, response);
    }
    return data as T;
  }

  return {
    /** The better-auth client (auth + admin plugin), created on first access. */
    get auth(): ReturnType<typeof makeAuthClient> {
      return getAuth();
    },
    /** Low-level typed request against the app's REST API. */
    request,
    get: <T>(path: string): Promise<T> => request<T>("GET", path),
    post: <T>(path: string, body?: unknown): Promise<T> => request<T>("POST", path, body),
    put: <T>(path: string, body?: unknown): Promise<T> => request<T>("PUT", path, body),
    patch: <T>(path: string, body?: unknown): Promise<T> => request<T>("PATCH", path, body),
    del: <T>(path: string): Promise<T> => request<T>("DELETE", path),
  };
}

/** The client returned by {@link createApiClient}. */
export type ApiClient = ReturnType<typeof createApiClient>;
