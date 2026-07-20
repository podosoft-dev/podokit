import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { requireBackendAvailable } from "$lib/server/guards";

export const load: PageServerLoad = async (event) => {
  event.setHeaders({ "X-Robots-Tag": "noindex, nofollow" });
  requireBackendAvailable(event.locals);
  if (!event.locals.user) throw redirect(303, "/login?redirect=/blog/write");
  return {};
};
