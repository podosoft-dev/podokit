import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { Pool } from "pg";
// podokit:auth-imports

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
    // podokit:auth-email-password
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
  // podokit:auth-options
});
