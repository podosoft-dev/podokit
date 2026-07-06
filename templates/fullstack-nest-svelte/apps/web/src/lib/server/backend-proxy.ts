// Server-side proxy boundary. The browser never talks to the API directly:
// requests go through SvelteKit server routes, which forward an allowlist of
// headers to BACKEND_INTERNAL_URL and relay the response (including Set-Cookie).
const FORWARDED_HEADERS = ["authorization", "cookie", "content-type", "accept", "origin", "referer"];
const RELAYED_RESPONSE_HEADERS = ["content-type", "location", "cache-control"];

export function backendBaseUrl(): string {
  return process.env.BACKEND_INTERNAL_URL ?? "http://localhost:3000";
}

export async function proxyRequest(
  request: Request,
  targetUrl: string,
  clientAddress?: string,
): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Forward the resolved client IP so the API (better-auth) can record it.
  if (clientAddress) headers.set("x-forwarded-for", clientAddress);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: hasBody ? await request.text() : undefined,
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  for (const name of RELAYED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  // Relay Set-Cookie so auth session cookies reach the browser.
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
