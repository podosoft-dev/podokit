---
name: podokit-configure-auth
description: Configure and verify PodoKit social OAuth providers, SMTP delivery, and the administrator sign-up approval policy. Use when enabling Google, Apple, or another Better Auth provider; calculating callback URLs; applying credentials through Admin Settings; configuring outbound mail; or diagnosing why a configured sign-in method is unavailable.
---

# Configure PodoKit authentication

Use the generated `auth:configure` command so credentials enter the encrypted `auth_config` store through the admin API. Keep provider secrets, SMTP passwords, and administrator passwords out of source files, command arguments, logs, and commits.

## Choose the workflow

- Read [references/google.md](references/google.md) for Google sign-in, including External audience requirements.
- Read [references/apple.md](references/apple.md) for Apple sign-in and client-secret rotation.
- Read [references/smtp.md](references/smtp.md) for Google Workspace SMTP relay and DNS authentication.
- Run the same generated command for other provider IDs. Confirm the provider appears in Admin Settings before applying it.

## Prepare the app

1. Confirm the `auth` and `admin-dashboard` modules are installed with `podo status`.
2. Confirm `BETTER_AUTH_URL` is the public authentication origin. Production should use HTTPS.
3. Run Better Auth and TypeORM migrations before configuring a new app:

   ```bash
   npm run migrate:all -w <app>-api
   ```

4. Derive the default callback as `<BETTER_AUTH_URL>/api/auth/callback/<provider>`. Only set `OAUTH_REDIRECT_URI` when the provider requires an explicit override.

## Handle secrets safely

Load secrets from the deployment secret manager or prompt for them in the current shell. Do not place secret values directly in command arguments.

```bash
export AUTH_SETUP_ORIGIN="https://example.com"
export AUTH_SETUP_ADMIN_EMAIL="admin@example.com"
printf "Admin password: " >&2
IFS= read -r -s AUTH_SETUP_ADMIN_PASSWORD
printf "\n" >&2
export AUTH_SETUP_ADMIN_PASSWORD
printf "OAuth client secret: " >&2
IFS= read -r -s OAUTH_CLIENT_SECRET
printf "\n" >&2
export OAUTH_CLIENT_SECRET
export OAUTH_CLIENT_ID="provider-client-id"
```

Unset sensitive variables when finished:

```bash
unset AUTH_SETUP_ADMIN_PASSWORD OAUTH_CLIENT_SECRET SMTP_PASS
```

## Preview and apply

Preview a redacted plan first:

```bash
npm run auth:configure -w <app>-api -- --provider google --require-signup-approval --dry-run
```

Apply OAuth credentials and the approval policy:

```bash
npm run auth:configure -w <app>-api -- --provider google --require-signup-approval
```

Configure SMTP separately or in the same run. Passwordless IP-based relays may omit `SMTP_USER` and `SMTP_PASS`.

```bash
export SMTP_HOST="smtp-relay.example.com"
export SMTP_PORT="587"
export SMTP_SECURE="false"
export MAIL_FROM="Example <noreply@example.com>"
npm run auth:configure -w <app>-api -- --smtp
```

## Verify

1. Check the public capability snapshot:

   ```bash
   npm run auth:configure -w <app>-api -- --provider google --check-only
   ```

2. Open `/login` and confirm the provider button appears.
3. With sign-up approval enabled, register a disposable account and confirm it reaches `/pending-approval` without a session.
4. Open `/admin/users`, filter by **Pending approval**, approve the account, and confirm sign-in succeeds.
5. Confirm administrator-created users and emails in `ADMIN_EMAILS` do not enter the approval queue.
6. Send a real verification or password-reset email and inspect SPF, DKIM, and DMARC results in the receiving mailbox.

## Preserve provider independence

Treat approval as a user lifecycle policy, not a provider option. Do not add Google-specific approval checks. New providers such as Apple must use the same user field and session gate automatically. Keep provider-specific setup and rotation details in a reference file while reusing `auth:configure` and Admin Settings.
