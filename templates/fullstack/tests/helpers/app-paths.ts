import type { AppPaths } from "./paths";

/**
 * Where this application's screens differ from the generated ones, for the
 * managed e2e specs. PodoKit creates this file once and never overwrites it.
 * Set only what differs; `paths.ts` documents each entry and its default. For
 * example, an app whose first screen is a signed-in workspace without a
 * heading, and which shows no public footer:
 *
 * ```ts
 * export const appPaths: Partial<AppPaths> = {
 *   homeReady: (page) => page.getByTestId("workspace"),
 *   indexable: [],
 *   footer: null,
 * };
 * ```
 */
export const appPaths: Partial<AppPaths> = {};
