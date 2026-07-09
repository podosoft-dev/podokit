import { Body, Controller, ForbiddenException, Get, Put } from "@nestjs/common";
import { Public, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { ApiTags } from "@nestjs/swagger";
import { FEATURE_FLAGS, SettingsService, type FeatureFlag } from "../settings/settings.service";

type Capabilities = {
  twoFactor: boolean;
  providers: string[];
  deleteAccount: boolean;
  auditLog: boolean;
  emailVerification: boolean;
  passwordBreachCheck: boolean;
  magicLink: boolean;
  emailOtp: boolean;
  username: boolean;
  multiSession: boolean;
  phoneNumber: boolean;
  apiKey: boolean;
};

function isAdmin(session: UserSession): boolean {
  const role = session.user?.role;
  const roles = Array.isArray(role) ? role : (role ?? "").split(",").map((r: string) => r.trim());
  return roles.includes("admin");
}

@ApiTags("account")
@Controller("account")
export class AccountController {
  constructor(private readonly settings: SettingsService) {}

  @Get("me")
  me(@Session() session: UserSession) {
    return session.user;
  }

  // Which optional auth features are enabled, so the UI can show/hide sections.
  // Public so the login page (unauthenticated) can offer available sign-in methods.
  @Public()
  @Get("capabilities")
  capabilities(): Capabilities {
    const flags = this.settings.flags();
    const providers = [
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "google" : null,
      process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET ? "github" : null,
    ].filter((p): p is string => p !== null);
    return {
      twoFactor: flags.twoFactor,
      magicLink: flags.magicLink,
      emailOtp: flags.emailOtp,
      username: flags.username,
      multiSession: flags.multiSession,
      phoneNumber: flags.phoneNumber,
      apiKey: flags.apiKey,
      // Server-enforced flags are boot-time (environment), not live-toggleable.
      providers,
      deleteAccount: process.env.AUTH_ALLOW_DELETE === "true",
      auditLog: process.env.AUDIT_LOG_ENABLED === "true",
      emailVerification: process.env.AUTH_EMAIL_VERIFICATION === "true",
      passwordBreachCheck: process.env.AUTH_HIBP === "true",
    };
  }

  // Admin-only: toggle feature flags. Stored in the DB and reflected immediately in
  // capabilities (UI). Server-enforced behaviours (email verification, breach check)
  // are read by the auth server at startup, so those take effect on the next restart.
  @Put("settings")
  async updateSettings(
    @Session() session: UserSession,
    @Body() body: Partial<Record<FeatureFlag, boolean>>,
  ): Promise<Record<FeatureFlag, boolean>> {
    if (!isAdmin(session)) throw new ForbiddenException("Admins only");
    const update: Partial<Record<FeatureFlag, boolean>> = {};
    for (const flag of FEATURE_FLAGS) {
      if (typeof body?.[flag] === "boolean") update[flag] = body[flag];
    }
    return this.settings.setMany(update);
  }
}
