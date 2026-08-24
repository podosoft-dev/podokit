# @podosoft/podokit-module-analytics

Optional provider-neutral web analytics for PodoKit applications. The first
provider is Google Analytics 4. It collects anonymous page and application
events, keeps service-account credentials encrypted in the application
database, and reads aggregate reports through the Google Analytics Data API.
It does not store raw visitor events in the application database.

## Install

```bash
bun add --dev @podosoft/podokit-module-analytics
podo add analytics
bun install
bun run --cwd apps/api migration:run
```

Open **Settings → Analytics** as an administrator and enter:

1. the web stream measurement ID (`G-...`);
2. the numeric GA4 property ID; and
3. a service-account JSON credential whose service account has Viewer access
   to that property.

Enable the Google Analytics Data API for the credential's Google Cloud project.
Use a dedicated, least-privilege service account and rotate its key. The JSON
credential is encrypted with the key derived from `BETTER_AUTH_SECRET`; changing
that application secret without re-entering the credential makes it unreadable.
The settings page includes a scrollable credential guide with the current
Google Analytics and Google Cloud console steps, security notes, and links to
the official documentation.

Use **Test connection** before enabling collection. Reports appear at
`/admin/analytics`.

## Consent and privacy

The runtime uses Google Consent Mode v2 in advanced mode. Analytics, ad storage,
ad user data, and ad personalization start denied. Accepting analytics grants
only analytics storage; advertising consent remains denied. When analytics
storage is denied, Google can still receive cookieless pings. Explain this in
the application's privacy notice.

PodoKit does not send Better Auth user IDs, names, or email addresses. Public
and signed-in product pages are measured by default, while admin,
authentication, account, maintenance, and error routes are excluded. Query
strings and fragments are never sent. Customize sensitive application paths in
`apps/web/src/lib/analytics.config.ts`.

The runtime sends one manual `page_view` per SvelteKit navigation. In the GA4
web stream, disable **Enhanced measurement → Page views → Page changes based on
browser history events** to prevent duplicate page views.

## Application events

```ts
import { trackAnalyticsEvent } from "#lib/analytics.js";

trackAnalyticsEvent("generate_lead", { method: "contact_form" });
```

Use recommended GA4 event names where possible. Never include personal,
sensitive, secret, or high-cardinality values in event parameters. Mark the
events that represent product goals as key events in the GA4 property so they
are included in the dashboard's key-event totals.

## Update

```bash
bun update @podosoft/podokit-module-analytics
podo update
podo update --apply
```
