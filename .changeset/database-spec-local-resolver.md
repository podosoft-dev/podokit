---
"@podosoft/podokit": patch
---

Make the generated API's database spec look up a host that does not exist through a DNS server on a local UDP port instead of the system resolver, so its result no longer depends on the machine's DNS. The test fetched `http://database.invalid/` and timed out after 30 seconds on CI runners whose resolver did not answer. It now checks a real `NXDOMAIN` answer (`ENOTFOUND`) in milliseconds and, in a new test, a resolver that never answers (`ETIMEOUT`) in about a second.
