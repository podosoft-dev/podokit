# @podosoft/podokit-contracts

Shared contracts for PodoKit apps — the pieces the NestJS backend and the
SvelteKit frontend must agree on, in one place so they cannot drift:

- `Capabilities` — feature flags reported at `GET /account/capabilities`.
- `ErrorEnvelope` / `ErrorBody` — the standard non-2xx response shape.
- `AppException` — backend exception carrying a stable `code`.
- `SIGNUP_APPROVAL_REQUIRED` — the stable pending-registration error code.
- `PUBLIC_SIGNUP_DISABLED` — the stable closed-registration error code.

Pure types and small classes, zero runtime dependencies.

## Install

```sh
npm install @podosoft/podokit-contracts
```

## Usage

```ts
import { AppException, type Capabilities, type ErrorEnvelope } from "@podosoft/podokit-contracts";

// backend: throw with a stable, language-independent code
throw new AppException("EMAIL_TAKEN", "That email is already registered", 409);

// frontend: branch on error.code, not the message
```

Most apps get these through the generated code and `@podosoft/podokit-api-client`
rather than importing this package directly.

## License

Apache-2.0
