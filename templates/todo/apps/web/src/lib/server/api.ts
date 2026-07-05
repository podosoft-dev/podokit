import type { RequestEvent } from "@sveltejs/kit";
import { createApiClient, type ApiClient } from "@podosoft/podokit-api-client";
import { backendBaseUrl } from "./backend-proxy";

// Server-side client for load functions and hooks: points at the internal
// backend URL and forwards the incoming request's cookies.
export function serverApiClient(event: RequestEvent): ApiClient {
  const cookie = event.request.headers.get("cookie") ?? "";
  const fetchWithCookies: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set("cookie", cookie);
    return event.fetch(input, { ...init, headers });
  };
  return createApiClient({
    baseUrl: backendBaseUrl(),
    apiBasePath: "",
    fetch: fetchWithCookies,
  });
}
