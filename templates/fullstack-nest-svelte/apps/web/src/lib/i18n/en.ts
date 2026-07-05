import type { BaseTranslation } from "typesafe-i18n";

// Base locale. Run `npx typesafe-i18n` to generate the typed runtime,
// then access strings as `$LL.appTitle()` in components.
const en = {
  appTitle: "{{projectName}}",
  checkHealth: "Check API health",
} satisfies BaseTranslation;

export default en;
