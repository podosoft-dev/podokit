---
"@podosoft/podokit-runtime": minor
"@podosoft/podokit": patch
---

Tell SSE clients to reload after an event transport outage. The runtime `EventBus` contract gains an optional `onInterruption(listener)` that a transport calls when delivery resumes after an outage in which events may have been lost, and `subscribe` is documented to register handlers without waiting for the transport. The `sse` module sends one `resync` frame to every open stream when that happens, so clients refetch the state they missed while their stream stayed open.
