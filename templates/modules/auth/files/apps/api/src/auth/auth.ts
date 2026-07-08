import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { Pool } from "pg";
import { actionEmail, sendMail } from "../mail/mailer";
// podokit:auth-imports

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
const plugins: BetterAuthPlugin[] = [];
if (process.env.AUTH_TWO_FACTOR === "true") {
  plugins.push(twoFactor());
}
// podokit:auth-plugins

export const auth = betterAuth({
  database: new Pool({
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "podokit",
    password: process.env.POSTGRES_PASSWORD ?? "podokit",
    database: process.env.POSTGRES_DB ?? "podokit",
  }),
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
    // Self-service account deletion — opt in with AUTH_ALLOW_DELETE=true.
    deleteUser: { enabled: process.env.AUTH_ALLOW_DELETE === "true" },
  },
  // podokit:auth-options
});
