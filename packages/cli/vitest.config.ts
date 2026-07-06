import { defineConfig } from "vitest/config";

// Only run the CLI's own unit tests — never the Playwright *.spec.ts files
// copied into dist/templates by the build.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
