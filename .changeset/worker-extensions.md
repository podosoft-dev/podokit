---
"@podosoft/podokit": minor
---

Add the bullmq module's application-owned `apps/api/src/worker.extensions.ts`. `configureWorkers(setup)` returns the application's queues for the worker process, with optional BullMQ worker options, and releases what it opened through `setup.onClose` after the workers stop, so apps stop editing the managed `worker.module.ts` and `main-worker.ts`. `startWorkers()` is asynchronous and returns `{ workers, close }`; two workers for one queue fail at startup.
