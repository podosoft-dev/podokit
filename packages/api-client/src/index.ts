import { createAuthClient } from "better-auth/client";
import { adminClient, twoFactorClient, magicLinkClient, emailOTPClient, usernameClient, multiSessionClient, phoneNumberClient, organizationClient, inferAdditionalFields } from "better-auth/client/plugins";
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
// Capabilities is a shared contract; re-exported so existing frontend imports
// (`from "@podosoft/podokit-api-client"`) keep working.
export type { Capabilities } from "@podosoft/podokit-contracts";

/** Stable authentication policy error codes re-exported for browser clients. */
export {
  PROFILE_IMAGE_DIMENSIONS_INVALID,
  PROFILE_IMAGE_NOT_FOUND,
  PROFILE_IMAGE_POLICY,
  PROFILE_IMAGE_REQUIRED,
  PROFILE_IMAGE_TOO_LARGE,
  PROFILE_IMAGE_TYPE_INVALID,
  PUBLIC_SIGNUP_DISABLED,
  SIGNUP_APPROVAL_REQUIRED,
} from "@podosoft/podokit-contracts";
export type {
  ProfileImageMimeType,
  ProfileImageResponse,
} from "@podosoft/podokit-contracts";

/** Error thrown when the API returns the standard error envelope or a non-2xx status. */
export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;
  /** Seconds to wait before retrying, from a `Retry-After` header (for example on 429 or 503). */
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    details?: unknown,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Reads `Retry-After` as delay seconds or an HTTP date. */
function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** An error body as JSON, or undefined when a proxy or server answered with text or HTML. */
function errorBody(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function toApiError(data: unknown, response: Response): ApiError {
  const retryAfter = retryAfterSeconds(response);
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error: unknown }).error;
    if (error && typeof error === "object") {
      const record = error as Record<string, unknown>;
      return new ApiError(
        typeof record.code === "string" ? record.code : "HTTP_ERROR",
        typeof record.message === "string" ? record.message : response.statusText,
        typeof record.statusCode === "number" ? record.statusCode : response.status,
        record.details,
        retryAfter,
      );
    }
  }
  return new ApiError("HTTP_ERROR", response.statusText || "Request failed", response.status, undefined, retryAfter);
}

/**
 * A request body sent as is rather than as JSON: a `Blob` or `File`, bytes, or
 * a stream. Send large files as a `Blob` (or `blob.slice()` chunks); a stream
 * body needs a server and browser that support streaming uploads.
 */
export type BinaryBody = Blob | ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>;

/** Per-request options for {@link ApiClient} calls. */
export interface RequestOptions {
  /**
   * Content type of the body. Binary bodies default to the Blob's own type,
   * else `application/octet-stream`; JSON bodies to `application/json`.
   * Ignored for `FormData`, whose boundary the runtime sets.
   */
  contentType?: string;
  /** Additional request headers, such as `content-range` for a chunk. */
  headers?: Record<string, string>;
  /** Cancels the request, for example when the user abandons an upload. */
  signal?: AbortSignal;
}

// lib.dom does not declare `duplex` yet; fetch requires it for stream bodies.
type FetchInit = RequestInit & { duplex?: "half" };

function isBinaryBody(body: unknown): body is BinaryBody {
  return (
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof ReadableStream !== "undefined" && body instanceof ReadableStream)
  );
}

function requestInit(method: string, credentials: RequestCredentials, body: unknown, options: RequestOptions): FetchInit {
  const headers: Record<string, string> = { ...options.headers };
  const init: FetchInit = { method, credentials, ...(options.signal ? { signal: options.signal } : {}) };
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    init.body = body;
  } else if (isBinaryBody(body)) {
    headers["content-type"] =
      options.contentType ?? (body instanceof Blob && body.type ? body.type : "application/octet-stream");
    init.body = body as BodyInit;
    if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) init.duplex = "half";
  } else if (body !== undefined) {
    headers["content-type"] = options.contentType ?? "application/json";
    init.body = JSON.stringify(body);
  }
  if (Object.keys(headers).length > 0) init.headers = headers;
  return init;
}

/**
 * Create a typed API client. Every frontend talks to the PodoKit backend
 * through this single entry point — never with a raw fetch.
 *
 * - `client.auth` is the better-auth client (email/password, sessions, and the
 *   admin plugin: `client.auth.admin.listUsers()`, `banUser`, `setRole`, ...).
 * - `client.get/post/put/patch/del` call the app's REST endpoints and parse
 *   the standard error envelope, throwing {@link ApiError} on failure. Bodies
 *   are sent as JSON, except `FormData` (multipart, with the runtime's
 *   boundary) and {@link BinaryBody} values, which are sent as they are.
 * - `client.postForm` sends multipart `FormData` without overriding the browser's
 *   boundary-aware content type.
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
      plugins: [
        adminClient(),
        twoFactorClient(),
        magicLinkClient(),
        emailOTPClient(),
        usernameClient(),
        multiSessionClient(),
        phoneNumberClient(),
        apiKeyClient(),
        passkeyClient(),
        // Teams are typed on the client; the server setting decides whether they answer.
        organizationClient({ teams: { enabled: true } }),
        inferAdditionalFields({
          user: {
            signupApproved: { type: "boolean", required: false, defaultValue: true, input: false },
          },
        }),
      ],
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

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await doFetch(
      `${baseUrl}${apiBasePath}${path}`,
      requestInit(method, credentials, body, options),
    );
    const text = await response.text();
    if (!response.ok) {
      throw toApiError(errorBody(text), response);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    /** The better-auth client (auth + admin plugin), created on first access. */
    get auth(): ReturnType<typeof makeAuthClient> {
      return getAuth();
    },
    /** Low-level typed request against the app's REST API. */
    request,
    get: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>("GET", path, undefined, options),
    post: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
      request<T>("POST", path, body, options),
    put: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
      request<T>("PUT", path, body, options),
    patch: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
      request<T>("PATCH", path, body, options),
    del: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>("DELETE", path, undefined, options),
    postForm: <T>(path: string, body: FormData, options?: RequestOptions): Promise<T> =>
      request<T>("POST", path, body, options),
  };
}

/** The client returned by {@link createApiClient}. */
export type ApiClient = ReturnType<typeof createApiClient>;
