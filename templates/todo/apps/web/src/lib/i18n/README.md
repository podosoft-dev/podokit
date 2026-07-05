# i18n

Locales use [typesafe-i18n](https://github.com/ivanhofer/typesafe-i18n).

- `en.ts` is the base locale; `ko.ts` mirrors its shape.
- Run `npx typesafe-i18n` to generate the typed runtime and Svelte store,
  then use `$LL.appTitle()` in components. Add keys to every locale.
