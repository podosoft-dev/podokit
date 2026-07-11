import type { PageServerLoad } from "./$types";
import { serverApiClient } from "$lib/server/api";

// The landing page shows a content nav built from the installed content modules.
// Collection keys come from data (empty/absent when content-collection isn't
// installed — the endpoint 404s and we fall back to none).
export const load: PageServerLoad = async (event) => {
  let collections: string[] = [];
  try {
    collections = await serverApiClient(event).get<string[]>("/collections");
  } catch {
    collections = [];
  }
  return { collections };
};
