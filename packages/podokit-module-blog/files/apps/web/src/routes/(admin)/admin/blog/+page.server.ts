import type { PageServerLoad } from "./$types";
import { requireAdmin } from "$lib/server/guards";
import { serverApiClient } from "$lib/server/api";
import type { BlogPost, Paginated } from "$lib/blog";

export const load: PageServerLoad = async (event) => {
  requireAdmin(event.locals.user, event.locals);
  const posts = await serverApiClient(event).get<Paginated<BlogPost>>("/admin/blog?page=1&pageSize=50");
  return { posts };
};
