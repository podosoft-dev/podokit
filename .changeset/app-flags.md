---
"@podosoft/podokit": minor
"@podosoft/podokit-contracts": minor
---

Add the auth module's application-owned `apps/api/src/settings/app-flags.ts` with `APP_FLAG_DEFAULTS`. Application flags are stored with the feature flags, changed with `PUT /account/settings`, read with `SettingsService.getBool()`, and returned as `appFlags` by `GET /account/capabilities` (`Capabilities.appFlags`), so apps stop editing the managed `flag-defaults.ts` and adding their own capability routes. A name PodoKit already uses fails at startup.
