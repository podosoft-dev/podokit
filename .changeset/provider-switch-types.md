---
"@podosoft/podokit": patch
---

Keep the API type-checking after `podo provider set ... --apply`. The generated `apps/api/src/config/providers.ts` now declares `PROVIDERS` as `Readonly<ProviderSelections>` instead of `as const`, so the previous provider's module, which stays installed and inactive for a rollback, no longer fails `tsc` (TS2367) on its own selection check after a cache, object storage, events, or jobs switch.
