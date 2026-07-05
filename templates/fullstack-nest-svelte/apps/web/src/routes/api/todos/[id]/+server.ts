import type { RequestHandler } from "@sveltejs/kit";
import { backendBaseUrl, backendProxyHeaders } from "$lib/server/backend-proxy";

export const PATCH: RequestHandler = async ({ request, params }) => {
  const headers = backendProxyHeaders(request);
  headers.set("content-type", "application/json");
  const upstream = await fetch(`${backendBaseUrl()}/todos/${params.id}`, {
    method: "PATCH",
    headers,
    body: await request.text(),
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  const upstream = await fetch(`${backendBaseUrl()}/todos/${params.id}`, {
    method: "DELETE",
    headers: backendProxyHeaders(request),
  });
  return new Response(null, { status: upstream.status });
};
