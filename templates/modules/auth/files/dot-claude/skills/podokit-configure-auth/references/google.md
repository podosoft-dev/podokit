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

Official references:

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2/policies
- https://better-auth.com/docs/authentication/google
