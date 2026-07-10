import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { serverApiClient } from "$lib/server/api";
import type { CollectionItem } from "$lib/content-collection";

export const load: PageServerLoad = async (event) => {
  const { collection, slug } = event.params;
  try {
    const item = await serverApiClient(event).get<CollectionItem>(`/collections/${collection}/${slug}`);
    return { item };
  } catch {
    error(404, "Not found");
  }
};
