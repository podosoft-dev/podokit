---
"@podosoft/podokit": minor
---

Add the `notifier` module for operator alerts. `notifyOperators({ title, message, url?, urlTitle?, priority? })` sends to Pushover, email (through the mailer), and a JSON webhook in parallel, with a 5-second timeout per channel; it never throws and returns each channel's result. With auth installed, administrators configure the channels under Settings → Operator notifications (secrets encrypted in `auth_config`, applied without a restart) and send a test notification; `PUSHOVER_APP_TOKEN`, `PUSHOVER_USER_KEY`, `NOTIFY_EMAIL_TO`, and `NOTIFY_WEBHOOK_URL` are the field-wise fallback. Apps add or replace channels with `setNotifyChannel`. The mailer's `Mail` type gains an optional `replyTo`, and the development SMS sink also captures requests posted to `/hooks/<name>`.
