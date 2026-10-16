---
"@podosoft/podokit": minor
---

Show the application's flags on the admin Settings page. Each flag listed in `APP_FLAG_SETTINGS` of the admin-dashboard's application-owned `apps/web/src/lib/admin/app-flags.ts` gets a switch on an Application tab, labelled from the app's catalog and saved through `PUT /account/settings` with the same administrator requirement as the Authentication tab's switches; the tab is hidden while the list is empty. A managed `tests/ui/app-flags.ui.spec.ts` covers it. The settings page's tab list wraps on narrow screens in new apps.
