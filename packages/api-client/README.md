# @podosoft/podokit-api-client

Typed API client for PodoKit backends. Every frontend talks to the backend
through this single entry point — never with a raw `fetch`.

- `client.auth` — the [better-auth](https://better-auth.com) client (email/password,
  sessions, the `signupApproved` user field, and the admin plugin: `listUsers`,
  `updateUser`, `banUser`, `setRole`, `listUserSessions`, …).
- `client.get/post/put/patch/del` — the app's JSON REST endpoints, parsing the
  standard error envelope and throwing `ApiError` on failure.
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
