---
"@podosoft/podokit": patch
---

Add a generated e2e spec, `tests/ui/same-origin-requests.ui.spec.ts`, that sends a `FormData` upload, a form-encoded body, and `POST` and `DELETE` requests without a body from the browser through the `/api` proxy and checks that each reaches the API with the page's `Origin`. The deployment guide explains the 403 "Cross-site POST form submissions are forbidden" such requests get when the web server resolves another origin than the browser, usually an ingress that replaces a TLS proxy's `X-Forwarded-Proto`, and why the fix belongs in the proxy configuration rather than in the client.
