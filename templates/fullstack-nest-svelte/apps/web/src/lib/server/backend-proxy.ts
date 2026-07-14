// Server-side proxy boundary. The browser never talks to the API directly:
// requests go through SvelteKit server routes, which forward an allowlist of
// headers to BACKEND_INTERNAL_URL and relay the response (including Set-Cookie).
const FORWARDED_HEADERS = ["authorization", "cookie", "content-type", "accept", "origin", "referer"];
const RELAYED_RESPONSE_HEADERS = ["content-type", "location", "cache-control"];

export function backendBaseUrl(): string {
  return process.env.BACKEND_INTERNAL_URL ?? "http://localhost:5002";
}

// Normalize the resolved client IP for the forwarded header. better-auth stores
// IPv4 as-is but anonymizes IPv6 (masks the host bits), so an IPv6 loopback would
// be recorded as "::" — map loopback to 127.0.0.1 for a clean local value, and
// unwrap IPv4-mapped addresses.
export function normalizeClientIp(address: string | undefined): string | undefined {
  if (!address) return undefined;
  if (address === "::1" || address === "::") return "127.0.0.1";
  if (address.startsWith("::ffff:")) return address.slice("::ffff:".length);
  return address;
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
  const forwardedIp = normalizeClientIp(clientAddress);
  if (forwardedIp) headers.set("x-forwarded-for", forwardedIp);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    // Preserve multipart uploads and other binary bodies byte-for-byte. Reading
    // them as text corrupts bytes that are not valid UTF-8 before forwarding.
    body: hasBody ? await request.arrayBuffer() : undefined,
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
