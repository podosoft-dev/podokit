# Localization

PodoKit applications compose UI messages from JSON catalogs. English is the
stable fallback, Korean is included, and additional BCP 47 locales can be added
without changing the message runtime.

## Layout

```text
apps/web/src/lib/i18n/
├── locales/                  # app-owned locale definitions
│   ├── en.json
│   └── ko.json
└── catalogs/
    ├── admin-dashboard/      # managed by the PodoKit module
    ├── blog/                 # managed by the installed blog module
    └── app/                  # app-owned messages and overrides
        ├── en.json
        └── ko.json
```

The runtime discovers `locales/*.json` and lazily loads
`catalogs/*/<locale>.json`. Module catalogs merge in stable name order and the
app catalog merges last. This gives each module an independently updateable
catalog while allowing intentional app-specific copy overrides.

Locale definition files contain a canonical BCP 47 code, display name, text
direction, and activation state:

```json
{
  "code": "pt-BR",
  "name": "Português (Brasil)",
  "direction": "ltr",
  "enabled": false
}
```

## Add A Locale

Run locale commands inside a generated project:

```bash
podo locale list
podo locale add pt-BR --name "Português (Brasil)"
# Translate apps/web/src/lib/i18n/catalogs/app/pt-BR.json
podo locale validate pt-BR
podo locale activate pt-BR
```

`add` never overwrites an existing definition or catalog. A new locale starts
inactive. `validate` compares the composed locale with English, reports coverage,
checks JSON value types, and requires all `{placeholder}` names to match. Partial
catalogs may be activated; missing keys use fallback messages at runtime.

Use `podo locale deactivate <code>` to remove a language from the switch without
deleting its translations. English cannot be deactivated.

## Fallback

The effective merge order is:

1. English
2. the configured site default
3. the selected locale

Later entries override earlier entries, so a missing selected-locale key falls
back to the site default and then English. The site default is stored in runtime
site settings and can be changed from **Admin → Settings → General → Language**.

The language switch stores the selected locale in a cookie. Server rendering
uses that cookie before the site default and rewrites the existing `<html lang>`
value, so applications may own `app.html` and choose any static default without
breaking a different selected language on reload.

This message fallback is independent from localized application records. Content
such as articles, FAQs, or collection entries needs locale-aware persistence,
draft/publication state, and an application-owned record fallback policy.

## Development Reloading

Vite tracks existing JSON catalogs as module dependencies. Saving an existing
catalog in development updates the UI through HMR without restarting the web
container. Adding a new definition or catalog changes the glob membership and
may cause an automatic full-page reload. Keep the whole `apps/web/src` directory
mounted or synchronized in the development compose configuration.

The generated `$podokit-add-locale` skill guides coding agents through addition,
validation, activation, fallback testing, and HMR verification.

## Application-Owned Responsibilities

PodoKit supplies catalogs, locale selection primitives, and the administrator
site-default setting. A consuming application owns its public URL strategy,
canonical and alternate links, localized sitemap entries, and dynamic-content
translation schema. This keeps framework localization reusable without imposing
one SEO or publishing policy on every product.
