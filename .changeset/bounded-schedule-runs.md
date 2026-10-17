---
"@podosoft/podokit": patch
"@podosoft/podokit-runtime": patch
---

Remove finished runs of `JobQueue.schedule()` beyond a limit instead of keeping every one: after a scheduled run finishes, the BullMQ and local providers keep the newest 100 completed and 1000 failed jobs of its name, and a new optional `ScheduleOptions` argument sets `keepCompleted` and `keepFailed` (0 removes only the run). The runtime exports `ScheduleOptions`, `scheduleRetention()`, and the default limits.
