---
"@podosoft/podokit": minor
"@podosoft/podokit-contracts": minor
---

Let `AppException` carry `details`. Its optional fourth argument is returned as `error.details` in the API's error envelope, so apps stop subclassing it and editing the managed `app.ts`. The API's error rendering moved into the exported `renderError()`.
