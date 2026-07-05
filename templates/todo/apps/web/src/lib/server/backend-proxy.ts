// Server-side proxy boundary. The browser never talks to the API directly:
// only these allowlisted headers are forwarded to BACKEND_INTERNAL_URL.
const FORWARDED_HEADERS = ["authorization", "cookie", "content-type"];

export function backendBaseUrl(): string {
  return process.env.BACKEND_INTERNAL_URL ?? "http://localhost:3000";
}

export function backendProxyHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}
