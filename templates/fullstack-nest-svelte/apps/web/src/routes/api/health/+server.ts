import type { RequestHandler } from "@sveltejs/kit";
import { backendBaseUrl, backendProxyHeaders } from "$lib/server/backend-proxy";

export const GET: RequestHandler = async ({ request }) => {
  const upstream = await fetch(`${backendBaseUrl()}/health`, {
    headers: backendProxyHeaders(request),
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
};
