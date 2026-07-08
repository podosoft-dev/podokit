import type { PageServerLoad } from "./$types";
import type { Capabilities } from "@podosoft/podokit-api-client";

// Capabilities is public so the login page can offer whichever sign-in methods
// (magic link, ...) the server actually enabled.
export const load: PageServerLoad = async ({ fetch }) => {
  try {
    const res = await fetch("/api/account/capabilities");
    if (res.ok) return { capabilities: (await res.json()) as Capabilities };
  } catch {
    /* fall through to defaults */
  }
  return { capabilities: null };
};
