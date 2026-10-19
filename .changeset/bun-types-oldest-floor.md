---
"@podosoft/podokit": patch
---

Keep `bun run lint` passing in apps that locked `@types/bun` 1.4.0. The generated `apps/web/src/lib/server/backend-proxy.ts` removed its shutdown signal listener with `process.removeListener`, which `@types/bun` 1.4.0 declares only for `"memoryPressure"`, so the web type check failed after `podo update` in every app whose lockfile held that version (1.4.1 and later were fine). The listener now registers with `process.once` and needs no removal; a relayed event stream still ends on `SIGTERM` or `SIGINT`, and a process with no other listener still exits on the signal. New apps declare `@types/bun` `^1.4.0`, the Bun version the template pins, and existing apps keep their own `package.json` range. PodoKit's CI now type-checks a generated app a second time with the lowest `@types/bun` its range allows.
