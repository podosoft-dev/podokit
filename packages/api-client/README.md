# @podosoft/podokit-api-client

Typed API client for PodoKit backends. Every frontend talks to the backend
through this single entry point — never with a raw `fetch`.

- `client.auth` — the [better-auth](https://better-auth.com) client (email/password,
  sessions, the `signupApproved` user field, and the admin plugin: `listUsers`,
  `updateUser`, `banUser`, `setRole`, `listUserSessions`, …).
- `client.get/post/put/patch/del` — the app's REST endpoints, parsing the
  standard error envelope and throwing `ApiError` on failure. Bodies are JSON,
  except `FormData` and binary bodies, which are sent as they are.
- `client.postForm` — multipart uploads with the browser-managed boundary and the
  same credentials and error handling.

```ts
import { createApiClient } from "@podosoft/podokit-api-client";

// Browser (same-origin, through the SvelteKit proxy)
const api = createApiClient();
const health = await api.get("/health");
await api.auth.signIn.email({ email, password });

// Server-side (SSR): point at the internal backend and forward cookies
const api = createApiClient({ baseUrl: process.env.BACKEND_INTERNAL_URL, fetch });
const session = await api.auth.getSession();

// Multipart upload
const form = new FormData();
form.set("file", imageFile);
await api.postForm("/account/profile-image", form);
```

## Binary bodies and request options

`post`, `put`, and `patch` send a `Blob` (or `File`), an `ArrayBuffer`, a typed
array such as `Uint8Array`, or a `ReadableStream` as the raw request body.
Every call takes optional request options as its last argument:

| Option | Purpose |
| --- | --- |
| `contentType` | Content type of the body. Binary bodies default to the Blob's type, else `application/octet-stream`; JSON bodies to `application/json`. |
| `headers` | Additional headers, such as `content-range` or an idempotency key. |
| `signal` | An `AbortSignal` that cancels the request. |

```ts
// Upload a file in 8 MiB chunks, one request per chunk
const chunkSize = 8 * 1024 * 1024;
for (let part = 0; part * chunkSize < file.size; part++) {
  const chunk = file.slice(part * chunkSize, (part + 1) * chunkSize);
  await api.put(`/uploads/${id}/parts/${part + 1}`, chunk, {
    contentType: "application/octet-stream",
    signal: controller.signal,
  });
}
```

A `ReadableStream` body is sent with `duplex: "half"`. Browsers stream request
bodies only over HTTP/2 or later, and not every browser supports them, so send
`Blob` slices from the browser and keep streams for server-side code. The SvelteKit
`/api` proxy and the API each enforce their own request size limits.

`ApiError.retryAfterSeconds` holds the `Retry-After` delay of a failed response,
such as `429 RATE_LIMIT_EXCEEDED` or `503`, when the server sends one. Apps that
called `fetch` directly to send binary chunks or to read `Retry-After` can use
these instead.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `baseUrl` | `""` | API origin. Empty = same-origin (browser via proxy); absolute URL for SSR. |
| `apiBasePath` | `/api` | Prefix for REST endpoints. |
| `authBasePath` | `/api/auth` | Prefix for the better-auth handler. |
| `fetch` | global `fetch` | Inject on the server to forward cookies. |
| `credentials` | `include` | Send cookies with requests. |

Errors are thrown as `ApiError` (`code`, `message`, `statusCode`, `details`).
`PUBLIC_SIGNUP_DISABLED` and `SIGNUP_APPROVAL_REQUIRED` are re-exported for
provider-independent registration-policy handling.
The profile-image policy, response type, and stable validation error codes are
also re-exported so account UIs can display the exact limits enforced by the API.

## Authentication upgrades

The client requires Better Auth 1.7.7 or newer within the 1.x release line, with
matching API key and passkey plugins. Upgrade the backend and its integrations
together. The 1.7.7 security update changes verification-record namespaces and
OAuth state encryption; pending Magic Links and OAuth/SAML sign-ins must be
restarted. See [the application upgrade guidance](../../docs/updating.md#better-auth-177-security-update).
