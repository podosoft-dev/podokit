# tests

End-to-end tests for this app, run with [`@playwright/test`](https://playwright.dev):

```bash
npm run test:e2e         # all specs (api + ui)
npm run test:e2e:api     # backend endpoints (request-only)
npm run test:e2e:ui      # pages (chromium)
npm run test:e2e:report  # open the HTML report
```

The suite runs against a live stack (web on `E2E_BASE_URL`, default
`http://localhost:5173`, proxying `/api/*` to the API). Start PostgreSQL, run the
auth migration, and start the API + web first. Files ending in `*.api.spec.ts` run
in the request-only `api` project; `*.ui.spec.ts` run in the chromium `ui` project.
