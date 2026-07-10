import type { PageServerLoad } from "./$types";
import { serverApiClient } from "$lib/server/api";
import type { CollectionItem } from "$lib/content-collection";

export const load: PageServerLoad = async (event) => {
  const collection = event.params.collection;
  try {
    const items = await serverApiClient(event).get<CollectionItem[]>(`/collections/${collection}`);
    return { collection, items };
  } catch {
    return { collection, items: [] as CollectionItem[] };
  }
};
