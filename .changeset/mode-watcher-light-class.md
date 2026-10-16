---
"@podosoft/podokit": minor
---

Mark the light theme on `<html>`. `site-runtime.svelte` now gives mode-watcher `lightClassNames={["light"]}`, so `<html>` carries `light` in light mode as it carries `dark` in dark mode, and component libraries that follow either class and otherwise fall back to the system setting match the chosen theme.
