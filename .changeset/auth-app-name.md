---
"@podosoft/podokit": minor
"@podosoft/podokit-auth": minor
---

Name the app in sign-in prompts. Better Auth's `appName`, the TOTP issuer shown by authenticator apps, and the passkey relying-party name shown by browsers now come from one value: `AUTH_APP_NAME` when set, otherwise the admin site name (`site.name`), otherwise the project name. Before, users saw "Better Auth" and "PodoKit". `AuthConfig` gains `appName`, and `createConfigStore()` takes `appNameSetting` (an app_setting key whose change changes the config version) and `defaults.appName`.
