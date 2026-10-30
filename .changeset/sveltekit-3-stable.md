---
"@podosoft/podokit": patch
---

New applications use the stable SvelteKit 3 release (`@sveltejs/kit` ^3.1.1, `@sveltejs/adapter-bun` ^1.0.0, `svelte` ^5.57.1) instead of the 3.0.0-next.25 prerelease. The prerelease has no fix for two SvelteKit advisories: an open redirect through enhanced form actions on routes that accept paths beginning with `//` (GHSA-pfhg-q3qv-9q6r), and unescaped `cache-control` values in prerendered pages (GHSA-27mw-82g8-phjj). Existing applications should apply the same ranges and regenerate their lockfile; see "SvelteKit 3 stable" in the updating guide.
