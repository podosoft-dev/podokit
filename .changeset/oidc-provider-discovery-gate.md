---
"@podosoft/podokit": patch
---

With the OIDC provider turned off in the admin settings, its discovery documents (`/api/auth/.well-known/openid-configuration` and `/api/auth/.well-known/oauth-authorization-server`, including the RFC 8414 form outside the base path) answer 404 like the provider's other endpoints. The provider served them from its own request hook, which runs before the feature gate, so they stayed public. The auth module now registers the feature gate as the first Better Auth plugin as well; the `jwt` plugin's `/api/auth/jwks` and `/api/auth/token` stay available.
