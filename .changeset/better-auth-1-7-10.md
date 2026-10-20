---
"@podosoft/podokit": patch
"@podosoft/podokit-api-client": patch
"@podosoft/podokit-mcp": patch
---

Update Better Auth and its API key, passkey, and OAuth provider plugins to 1.7.10 in the authentication module and the API client, and Zod to 4.6.7 in the MCP server. The Better Auth releases fix failed password resets consuming reset links, sessions left inconsistent when secondary storage fails during sign-up or passkey registration, missing multi-session device sessions after cache eviction, and several OAuth provider token, PKCE, and DPoP errors. New applications get the new versions; existing applications can raise the same ranges and regenerate their lockfile.
