import type { PageServerLoad } from "./$types";
import { serverApiClient } from "$lib/server/api";
import type { FaqItem } from "$lib/faq";

export const load: PageServerLoad = async (event) => {
  try {
    const items = await serverApiClient(event).get<FaqItem[]>("/faq");
    return { items };
  } catch {
    return { items: [] as FaqItem[] };
  }
};
