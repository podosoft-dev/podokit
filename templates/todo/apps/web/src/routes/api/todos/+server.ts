import type { RequestHandler } from "@sveltejs/kit";
import { backendBaseUrl, backendProxyHeaders } from "$lib/server/backend-proxy";

export const GET: RequestHandler = async ({ request }) => {
  const upstream = await fetch(`${backendBaseUrl()}/todos`, { headers: backendProxyHeaders(request) });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const headers = backendProxyHeaders(request);
  headers.set("content-type", "application/json");
  const upstream = await fetch(`${backendBaseUrl()}/todos`, {
    method: "POST",
    headers,
    body: await request.text(),
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
};
