import type { Messages } from "$lib/i18n/messages";

// Public content-nav registry. Content modules append top-nav entries here (via
// `podo add` injection), so the landing page's navigation menu grows with the
// installed content. Collections are added dynamically from data by the landing.
export type ContentNavEntry = {
  label: (t: Messages) => string;
  href: string;
};

export const contentNavEntries: ContentNavEntry[] = [
  // podokit:begin:content-nav
  // podokit:end:content-nav
];
