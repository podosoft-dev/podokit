---
"@podosoft/podokit": major
"@podosoft/podokit-mcp": major
"@podosoft/podokit-module-blog": major
"@podosoft/podokit-module-analytics": major
---

Generate Bun 1.4.0 applications with an Elysia request path, native Bun SQL,
Redis, and S3 integrations, Alpine production images, merged OpenAPI documents,
and executable endpoint-contract verification.

Replace the former runtime-selection and conversion surface with a Bun-only v1
project model. Existing PodoKit 0.x applications must remain on the final 0.x
CLI instead of being converted in place.

Port the Blog and Analytics external modules to the Elysia service registry and
Bun SQL while preserving their documented HTTP behavior and UI features.
