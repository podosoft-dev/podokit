import type { BaseTranslation } from "typesafe-i18n";

// Uses BaseTranslation until you generate typed runtimes with `npx typesafe-i18n`.
// After generating, switch to `import type { Translation } from "../i18n-types"`
// so this locale is checked against the base locale's keys.
const ko = {
  appTitle: "{{projectName}}",
  checkHealth: "API 상태 확인",
} satisfies BaseTranslation;

export default ko;
