# Google sign-in

Use a Google Cloud project owned by the organization, not a personal project.

1. Configure the Google Auth Platform brand, support email, developer contact, privacy policy, and terms links.
2. Choose **External** when every Google account may sign in. Publish the app to **Production** after testing; test mode restricts users and refresh-token lifetime.
3. Create a **Web application** OAuth client.
4. Add the web origin, for example `https://example.com`, to authorized JavaScript origins.
5. Add the exact callback `https://example.com/api/auth/callback/google` to authorized redirect URIs.
6. Supply the client ID and secret to `auth:configure`; never commit either value.
7. Request only the scopes the application uses. Basic sign-in normally needs OpenID, email, and profile.

Google may require verification for an External production app, especially when sensitive scopes or branding are involved. Keep the homepage, privacy policy, terms, and verified domain consistent with the OAuth consent screen.

## Local development

Google's HTTP development exception applies to the literal `localhost` host (and
localhost IP addresses), not to custom loopback names such as `app.localhost`.
Use the same container stack through its literal localhost URL for the entire
OAuth round trip:

1. Add `http://localhost:<port>` as an authorized JavaScript origin.
2. Add `http://localhost:<port>/api/auth/callback/google` as an authorized
   redirect URI. The port and path must match exactly.
3. Include `http://localhost:<port>` in `CORS_ORIGIN` / Better Auth trusted
   origins. The generated Docker environment includes literal localhost by
   default; add the published port when an override uses a non-default port.
4. Configure the local provider callback without putting the secret on the
   command line:

   ```bash
   export AUTH_SETUP_ORIGIN="http://localhost:<port>"
   export AUTH_SETUP_ADMIN_EMAIL="admin@example.com"
   export AUTH_SETUP_ADMIN_PASSWORD="<from-secret-manager>"
   export OAUTH_CLIENT_ID="<google-client-id>"
   export OAUTH_CLIENT_SECRET="<from-secret-manager>"
   npm run auth:configure -w <app>-api -- --provider google --dry-run
   npm run auth:configure -w <app>-api -- --provider google
   ```

5. Open `http://localhost:<port>` and start Google sign-in there. Do not start
   on `app.localhost` and return on `localhost`; OAuth state cookies are scoped
   to the host that created them.

`BETTER_AUTH_URL` may keep the normal custom local hostname when the provider has
the explicit localhost `redirectURI` written by `auth:configure`. For arbitrary
preview hostnames that Google cannot register, Better Auth's OAuth Proxy plugin
is an advanced alternative: it uses a registered production callback and a
dedicated shared proxy secret. That option requires a deployed production proxy
and is not necessary for ordinary localhost testing.

Official references:

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2/policies
- https://support.google.com/cloud/answer/15549257
- https://better-auth.com/docs/authentication/google
- https://better-auth.com/docs/plugins/oauth-proxy
