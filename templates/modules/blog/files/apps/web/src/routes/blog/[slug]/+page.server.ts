import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { serverApiClient } from "$lib/server/api";
import type { Post } from "$lib/blog";

export const load: PageServerLoad = async (event) => {
  try {
    const post = await serverApiClient(event).get<Post>(`/blog/${event.params.slug}`);
    return { post };
  } catch {
    error(404, "Not found");
  }
};
