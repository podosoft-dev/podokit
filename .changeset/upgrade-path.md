---
"@podosoft/podokit": patch
---

Fix the upgrade path from earlier releases to 1.2.0. `podo update` adds the module for the selected provider when a module gains a capability requirement (such as `sse` requiring `events`), lists it under "Modules to add", and moves a provider recorded after its dependents in front of them. `podo add` places a new provider ahead of the installed modules that need it. Template ranges for PodoKit packages name the current versions, so updated apps get `@podosoft/podokit-api-client` 0.8.5. `admin:bootstrap` loads a bundled runtime entry and works on PostgreSQL and SQLite. The audit filter index migration builds its PostgreSQL indexes concurrently, with TypeORM migrations running one transaction each. The SQLite auth configuration reports `enabled` as a boolean, and three UI specs wait for hydration or read responses before navigating on.
