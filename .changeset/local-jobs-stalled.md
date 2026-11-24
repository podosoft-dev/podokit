---
"@podosoft/podokit": patch
---

Recover local jobs that a stopped process left running. A job the `jobs-local` worker was running when the API restarted, crashed, or was replaced stayed `active` forever. Running jobs now record a heartbeat every 10 seconds; a job without one for 60 seconds is queued again once, as BullMQ does with stalled jobs, and fails if its process stops again.
