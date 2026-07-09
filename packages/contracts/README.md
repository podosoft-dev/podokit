# @podosoft/podokit-contracts

Shared contracts for PodoKit apps — the pieces the NestJS backend and the
SvelteKit frontend must agree on, in one place so they cannot drift:

- `Capabilities` — feature flags reported at `GET /account/capabilities`.
- `ErrorEnvelope` / `ErrorBody` — the standard non-2xx response shape.
- `AppException` — backend exception carrying a stable `code`.

Pure types and small classes, zero runtime dependencies.

```ts
import { AppException, type Capabilities } from "@podosoft/podokit-contracts";
```
