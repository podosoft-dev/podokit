import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  event.setHeaders({ "X-Robots-Tag": "noindex, nofollow" });
  if (!event.locals.user) throw redirect(303, "/login?redirect=/blog/write");
  return {};
};
