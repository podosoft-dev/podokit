import type { ProviderSelections } from "@podosoft/podokit-runtime";

export const PROVIDERS = {
  database: "{{databaseProvider}}",
  cache: "{{cacheProvider}}",
  "object-storage": "{{objectStorageProvider}}",
  events: "{{eventsProvider}}",
  jobs: "{{jobsProvider}}",
} as const satisfies ProviderSelections;
