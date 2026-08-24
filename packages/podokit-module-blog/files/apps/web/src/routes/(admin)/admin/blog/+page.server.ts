import type { PageServerLoad } from "./$types";
import { requireAdmin } from "#lib/server/guards.js";
import { serverApiClient } from "#lib/server/api.js";
import type { BlogPost, Paginated } from "#lib/blog.js";

export const load: PageServerLoad = async (event) => {
  requireAdmin(event.locals.user, event.locals);
  const posts = await serverApiClient(event).get<Paginated<BlogPost>>("/admin/blog?page=1&pageSize=50");
  return { posts };
};
