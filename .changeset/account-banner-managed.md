---
"@podosoft/podokit": patch
---

Render the `/account` impersonation banner in the managed `AccountPage` instead of the application-owned account page. The managed load returned the flag while only newly generated owned pages rendered the banner, so an update delivered half the feature. The load now returns `showImpersonationBanner`, the managed component shows the banner, the impersonation e2e spec opens `/account` itself instead of asserting where the owned users page navigates, and a repository test keeps owned pages beside managed loads from reading new fields.
