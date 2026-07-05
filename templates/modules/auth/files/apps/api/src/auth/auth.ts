import { betterAuth, type BetterAuthOptions } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { Pool } from "pg";

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

export const auth = betterAuth({
  database: new Pool({
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "podokit",
    password: process.env.POSTGRES_PASSWORD ?? "podokit",
    database: process.env.POSTGRES_DB ?? "podokit",
  }),
  emailAndPassword: { enabled: true },
  socialProviders: socialProviders(),
  plugins: process.env.AUTH_TWO_FACTOR === "true" ? [twoFactor()] : [],
  secret: process.env.BETTER_AUTH_SECRET ?? "change-me-in-production-min-32-characters",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
});
