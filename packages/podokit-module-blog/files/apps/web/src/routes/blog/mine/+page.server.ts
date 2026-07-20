import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { loadMyBlogPosts } from "$lib/blog/blog-data.server";

export const load: PageServerLoad = async (event) => {
  event.setHeaders({ "X-Robots-Tag": "noindex, nofollow" });
  if (!event.locals.user) throw redirect(303, "/login?redirect=/blog/mine");
  const requested = Number(event.url.searchParams.get("page") ?? "1");
  const page = Number.isInteger(requested) && requested > 0 ? requested : 1;
  return { posts: await loadMyBlogPosts(event, page) };
};
