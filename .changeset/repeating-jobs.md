---
"@podosoft/podokit": minor
"@podosoft/podokit-runtime": minor
---

Repeat jobs through the jobs contract. `JobQueue.schedule(id, name, payload, { cron | everyMs, timezone? })` adds a job on a cron expression or a fixed interval and replaces an earlier schedule with the same id, and `unschedule(id)` stops it. The BullMQ provider stores the schedules as Redis job schedulers and the local provider adds the jobs from a timer, once per time; both apply their schedules again when the connection is restored, resolve `schedule()` while the backend is down, and reject an invalid schedule. The runtime package exports `RepeatOptions`, `assertRepeatOptions()`, and `MIN_REPEAT_INTERVAL_MS`. Implementations of `JobQueue`, including test fakes, need the two new methods.
