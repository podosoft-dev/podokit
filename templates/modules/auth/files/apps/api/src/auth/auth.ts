import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { twoFactor, haveIBeenPwned, magicLink, emailOTP, username, multiSession, phoneNumber, organization, jwt } from "better-auth/plugins";
import { Pool } from "pg";
import { actionEmail, sendMail } from "../mail/mailer";
import { sendSms } from "../sms/sms";
import { createFeatureGate } from "./feature-gate";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { oauthProvider } from "@better-auth/oauth-provider";
// podokit:auth-imports

// Web origin(s) where the browser runs (WebAuthn ceremonies must match these).
const webOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((o) => o.trim());

const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? "podokit",
  password: process.env.POSTGRES_PASSWORD ?? "podokit",
  database: process.env.POSTGRES_DB ?? "podokit",
});

// Email verification is opt-in: when on, new sign-ups must confirm their address
// before they can sign in.
const emailVerificationEnabled = process.env.AUTH_EMAIL_VERIFICATION === "true";

// OAuth providers are enabled only when their credentials are present.
function socialProviders(): NonNullable<BetterAuthOptions["socialProviders"]> {
  const providers: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }
  return providers;
}

// Plugins are collected here so other PodoKit modules can add their own.
// Feature plugins (2FA, magic link, email OTP, username, multi-session, phone
// number) are always mounted; whether each is available is a DB-backed admin
// setting — defaults seeded by the app_setting migration, toggled live on the
// admin Settings page (see settings/settings.service.ts).
const plugins: BetterAuthPlugin[] = [
  twoFactor(),
  magicLink({
    sendMagicLink: async ({ email, url }: { email: string; url: string; token: string }) => {
      await sendMail({
        to: email,
        subject: "Your sign-in link",
        text: `Sign in: ${url}`,
        html: actionEmail("Sign in to your account", "Click the button below to sign in. This link expires shortly.", url, "Sign in"),
      });
    },
  }),
  emailOTP({
    sendVerificationOTP: async ({ email, otp }: { email: string; otp: string; type: string }) => {
      await sendMail({
        to: email,
        subject: "Your sign-in code",
        text: `Your one-time code is ${otp}. It expires shortly.`,
        html: `<p>Your one-time sign-in code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:3px">${otp}</p><p>It expires shortly.</p>`,
      });
    },
  }),
  // Adds username/displayUsername columns; lets users sign in with a username.
  username(),
  // Let one browser hold several signed-in accounts and switch between them.
  multiSession(),
  // Phone-number sign-in/verification. SMS delivery is a dev stub (logs the code);
  // wire a real provider in sendOTP for production.
  phoneNumber({
    sendOTP: async ({ phoneNumber: to, code }: { phoneNumber: string; code: string }) => {
      await sendSms({ to, body: `Your verification code is ${code}` });
    },
  }),
  // User-issued API keys (DB-backed). Distinct from the static X-API-Key module.
  apiKey(),
  // Passwordless sign-in with WebAuthn passkeys. The ceremony runs at the web
  // origin, so expected origins are the CORS origins and rpID is their host.
  // Change rpName to your product name (shown in the browser passkey prompt).
  passkey({ rpName: "PodoKit", rpID: new URL(webOrigins[0]).hostname, origin: webOrigins }),
  // Multi-tenant organizations: teams with members, roles, and email invitations.
  organization({
    sendInvitationEmail: async (data: { email: string; id: string; organization: { name: string }; inviter: { user: { name: string; email: string } } }) => {
      const url = `${webOrigins[0]}/accept-invitation/${data.id}`;
      await sendMail({
        to: data.email,
        subject: `You are invited to ${data.organization.name}`,
        text: `${data.inviter.user.name} invited you to ${data.organization.name}. Accept: ${url}`,
        html: actionEmail(
          `Join ${data.organization.name}`,
          `${data.inviter.user.name} (${data.inviter.user.email}) invited you to join ${data.organization.name}.`,
          url,
          "Accept invitation",
        ),
      });
    },
  }),
  // JWT/JWKS signing keys — required by the OAuth provider to sign id_tokens.
  jwt(),
  // Act as an OAuth2/OIDC identity provider: other apps can "Sign in with this app".
  // Register clients at /api/auth/oauth2/create-client; discovery at
  // /api/auth/.well-known/openid-configuration. See docs/modules.md.
  oauthProvider({ loginPage: "/login", consentPage: "/oauth2/consent" }),
];
// Reject passwords found in known breaches (Have I Been Pwned, k-anonymity range
// API). Server-enforced, so it's an environment flag applied at startup.
if (process.env.AUTH_HIBP === "true") {
  plugins.push(haveIBeenPwned());
}
// podokit:auth-plugins

// Request-time hooks. The feature gate turns the admin Settings toggles into a
// real server boundary (disabled features 404). Other PodoKit modules add their
// own hooks below the marker.
const hooks: NonNullable<BetterAuthOptions["hooks"]> = { before: createFeatureGate(pool) };
// podokit:auth-hooks

export const auth = betterAuth({
  database: pool,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: emailVerificationEnabled,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Reset your password",
        text: `Reset your password: ${url}`,
        html: actionEmail("Reset your password", "Click the button below to choose a new password.", url, "Reset password"),
      });
    },
    // podokit:auth-email-password
  },
  emailVerification: {
    sendOnSignUp: emailVerificationEnabled,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Verify your email",
        text: `Verify your email: ${url}`,
        html: actionEmail("Verify your email", "Confirm your address to finish setting up your account.", url, "Verify email"),
      });
    },
  },
  socialProviders: socialProviders(),
  plugins,
  hooks,
  secret: process.env.BETTER_AUTH_SECRET ?? "change-me-in-production-min-32-characters",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  advanced: {
    ipAddress: {
      // The API sits behind the SvelteKit server proxy, which forwards the
      // resolved client IP as x-forwarded-for; trust it so sessions record an IP.
      ipAddressHeaders: ["x-forwarded-for"],
    },
  },
  user: {
    // Self-service email change. When email verification is on, better-auth sends
    // an approval link to the current address before switching; otherwise it
    // changes immediately.
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({
        user,
        newEmail,
        url,
      }: {
        user: { email: string };
        newEmail: string;
        url: string;
      }) => {
        await sendMail({
          to: user.email,
          subject: "Approve your email change",
          text: `Approve changing your email to ${newEmail}: ${url}`,
          html: actionEmail(
            "Approve email change",
            `Confirm changing your email address to ${newEmail}.`,
            url,
            "Approve change",
          ),
        });
      },
    },
    // Self-service account deletion — opt in with AUTH_ALLOW_DELETE=true.
    deleteUser: { enabled: process.env.AUTH_ALLOW_DELETE === "true" },
  },
  // podokit:auth-options
});
