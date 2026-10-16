import type { ProviderSelections } from "@podosoft/podokit-runtime";

// Typed with every provider name, not the selected ones: the module of a
// provider that stays installed after a switch compares against its own name.
export const PROVIDERS: Readonly<ProviderSelections> = {
  database: "{{databaseProvider}}",
  cache: "{{cacheProvider}}",
  "object-storage": "{{objectStorageProvider}}",
  events: "{{eventsProvider}}",
  jobs: "{{jobsProvider}}",
};
