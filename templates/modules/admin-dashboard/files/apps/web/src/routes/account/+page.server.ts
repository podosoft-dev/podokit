import { loadAccountData } from "#lib/account-data.server.js";
import { loadProtectedLayout } from "#lib/server/protected-layout.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, fetch }) => {
  await loadProtectedLayout({ locals, fetch });
  return {
    ...(await loadAccountData(locals, fetch)),
    impersonating: Boolean(locals.session?.impersonatedBy),
  };
};
