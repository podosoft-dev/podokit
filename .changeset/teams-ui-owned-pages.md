---
"@podosoft/podokit": patch
---

Skip the generated organization teams UI tests in an application whose owned settings or organizations page does not render the Teams controls yet. After `podo update` from a version without teams, the managed tests arrived but the application-owned `/admin/settings` and `/admin/organizations` pages stayed as they were, so the tests failed looking for the Teams switch and the Teams action. They now skip with the reason until the pages render them, and still run in full in new applications.
