import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { loadBlogPost } from "$lib/blog/blog-data.server";
import { requireBackendAvailable } from "$lib/server/guards";

export const load: PageServerLoad = async (event) => {
  event.setHeaders({ "X-Robots-Tag": "noindex, nofollow" });
  requireBackendAvailable(event.locals);
  if (!event.locals.user) throw redirect(303, `/login?redirect=/blog/${event.params.slug}/edit`);
  const post = await loadBlogPost(event, event.params.slug);
  const admin = event.locals.user.role === "admin";
  if (!admin && post.authorId !== event.locals.user.id) throw error(403, "Forbidden");
  return { post };
};
