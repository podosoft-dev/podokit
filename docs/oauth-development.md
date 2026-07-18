# OAuth development over HTTPS

Keep normal multi-app development on the portless `*.localhost` URLs provided by
`podo dev`. When an identity provider requires a publicly registered HTTPS callback,
add a stable development origin through a tunnel or preview deployment. Do not change
the local URL model or add provider-specific tunnel dependencies to PodoKit.

## Stable callback contract

For a development origin such as `https://myapp-dev.example.com`, register:

- authorized origin: `https://myapp-dev.example.com`
- callback: `https://myapp-dev.example.com/api/auth/callback/<provider>`

Use a separate provider project or client for each deployment tier. This prevents a
development callback, test user, or consent-screen state from changing production.
Open Admin Settings through the HTTPS origin before saving a provider; the displayed
callback is persisted. The CLI does the same when `AUTH_SETUP_ORIGIN` is HTTPS:

```bash
export AUTH_SETUP_ORIGIN="https://myapp-dev.example.com"
export AUTH_SETUP_ADMIN_EMAIL="admin@example.com"
export AUTH_SETUP_ADMIN_PASSWORD="<from-secret-manager>"
export OAUTH_CLIENT_ID="<development-client-id>"
export OAUTH_CLIENT_SECRET="<from-secret-manager>"
npm run auth:configure -w <app>-api -- --provider google --dry-run
npm run auth:configure -w <app>-api -- --provider google
```

When credentials are already stored, repair a stale callback without reading or
replacing the client secret:

```bash
AUTH_SETUP_ORIGIN=https://myapp-dev.example.com \
  npm run auth:configure -w <app>-api -- --provider google --redirect-only
```

Add both the local and HTTPS origins to the API's `CORS_ORIGIN` and set
`BETTER_AUTH_URL` to the origin used for the OAuth round trip. Never start on one
origin and return on another because state cookies are scoped to the origin that
created them.

## Linking an existing email account

When a signed-in email/password user connects an OAuth provider from the account
page, the provider must return the same email address as the existing user. A
different address is rejected with `email_doesn't_match`; this is an account-takeover
protection, not a callback configuration failure. Do not enable
`account.accountLinking.allowDifferentEmails` merely to bypass the error.

If public sign-up is disabled, use this sequence:

1. Have an administrator create and approve the user with the intended provider
   email and assign any required role.
2. Sign out of the administrator account and sign in as the newly created user.
3. Connect the OAuth provider and select the provider account with that exact email.
4. Verify the callback returns to the original HTTPS page and the linked provider is
   listed on the account page.

For example, a user signed in as `admin@example.com` cannot link a Google account
for `dev@example.com`. Create or sign in as `dev@example.com` first, then connect
that Google account.

## Tunnel choices

- A Cloudflare Named Tunnel is a good fit when a Cloudflare-managed domain is already
  available. Pin `cloudflared`, store its connector token in a secret manager, and
  route the stable hostname to the web container. Protect development content with
  Access, but bypass the exact callback path so the provider can reach it.
- A reserved ngrok domain provides the same stable callback shape for teams that do
  not use Cloudflare.
- Ephemeral quick-tunnel hostnames are useful for short UI demonstrations, but not as
  a registered OAuth callback because the hostname changes.

PodoKit does not run or provision these providers. Keep their credentials and DNS or
Access automation in the application's infrastructure repository.

Provider documentation remains authoritative:

- Google OAuth client validation: https://support.google.com/cloud/answer/15549257
- Google OAuth production policy: https://developers.google.com/identity/protocols/oauth2/policies
- Apple web redirect requirements: https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/
- ngrok OAuth testing: https://ngrok.com/docs/guides/oauth/
- Better Auth account linking: https://better-auth.com/docs/concepts/users-accounts#account-linking
- Better Auth `email_doesn't_match`: https://better-auth.com/docs/reference/errors/email_doesn%27t_match
