# tests

End-to-end tests for this app, run with [`@playwright/test`](https://playwright.dev):

```bash
{{rootRun}} test:e2e         # all specs (api + ui)
{{rootRun}} test:e2e:api     # backend endpoints (request-only)
{{rootRun}} test:e2e:ui      # pages (chromium)
{{rootRun}} test:e2e:report  # open the HTML report
```

The suite runs against a live stack (web on `E2E_BASE_URL`, proxying `/api/*` to
the API). With the recommended containerized loop, start `podo dev watch` and run:

```bash
E2E_BASE_URL=http://{{projectName}}.localhost {{rootRun}} test:e2e
```

The default `http://localhost:5001` is for the alternative `{{rootRun}} dev`
host-process loop. Files ending in `*.api.spec.ts` run in the request-only `api`
project; `*.ui.spec.ts` run in the chromium `ui` project.
