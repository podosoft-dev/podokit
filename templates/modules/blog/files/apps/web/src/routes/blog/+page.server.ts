import type { PageServerLoad } from "./$types";
import { serverApiClient } from "$lib/server/api";
import type { Post } from "$lib/blog";

export const load: PageServerLoad = async (event) => {
  const tag = event.url.searchParams.get("tag");
  const path = tag ? `/blog?tag=${encodeURIComponent(tag)}` : "/blog";
  try {
    const posts = await serverApiClient(event).get<Post[]>(path);
    return { posts, tag };
  } catch {
    return { posts: [] as Post[], tag };
  }
};
