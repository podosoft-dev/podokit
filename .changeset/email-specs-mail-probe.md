---
"@podosoft/podokit": patch
---

Make the `admin-dashboard` module's email specs run only when the app under test delivers its mail to the Mailpit they read. They ran whenever a Mailpit answered on `MAILPIT_URL` (default `http://localhost:8025`), so in an app without SMTP, or one that sends to another catcher, another project's Mailpit on that port made every email test wait for a message that never came and fail. Before the first email test, each worker now has the app send a password reset email to a throwaway account and waits up to five seconds for it in that Mailpit; when it does not arrive, the email tests skip with the cause. `E2E_REQUIRE_MAIL=true` makes them fail instead.
