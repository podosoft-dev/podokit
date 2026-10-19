import type { Handle } from "@sveltejs/kit/hooks";
import { refuseCrossSiteForm } from "#lib/server/csrf.js";

// The cross-site form check, which vite.config.ts moves here from SvelteKit so
// that /api serves clients without an Origin header (see csrf.ts).
export const handle: Handle = ({ event, resolve }) => refuseCrossSiteForm(event) ?? resolve(event);
