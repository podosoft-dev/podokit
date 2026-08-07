import { loadAccountData } from "$lib/account-data.server";
import { loadProtectedLayout } from "$lib/server/protected-layout";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, fetch }) => {
  await loadProtectedLayout({ locals, fetch });
  return loadAccountData(locals, fetch);
};
