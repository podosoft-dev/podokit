import type { PageServerLoad } from "./$types";
import { loadBlogPosts } from "$lib/blog/blog-data.server";

export const load: PageServerLoad = async (event) => {
  const requested = Number(event.url.searchParams.get("page") ?? "1");
  const page = Number.isInteger(requested) && requested > 0 ? requested : 1;
  return { posts: await loadBlogPosts(event, page), user: event.locals.user };
};
