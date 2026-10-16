---
"@podosoft/podokit": patch
---

The admin dashboard's `request-budget.ui.spec.ts` reads each `__data.json` body through `page.route` instead of `response.text()`. Chromium can report the fetch as aborted (`net::ERR_ABORTED`) once SvelteKit has consumed the body and then keeps no body, so the spec failed with "No data found for resource" even though the page had its data.
