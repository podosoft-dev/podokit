import type { PageServerLoad } from "./$types";
import { loadBlogComments, loadBlogPost } from "$lib/blog/blog-data.server";

export const load: PageServerLoad = async (event) => {
  const requested = Number(event.url.searchParams.get("commentPage") ?? "1");
  const commentPage = Number.isInteger(requested) && requested > 0 ? requested : 1;
  const [post, comments] = await Promise.all([
    loadBlogPost(event, event.params.slug),
    loadBlogComments(event, event.params.slug, commentPage),
  ]);
  return { post, comments, user: event.locals.user };
};
