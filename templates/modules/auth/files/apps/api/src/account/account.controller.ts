import { Body, Controller, ForbiddenException, Get, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { Public, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { ApiTags } from "@nestjs/swagger";
import { FEATURE_FLAGS, SettingsService, type FeatureFlag } from "../settings/settings.service";
import { ROLE_NAMES } from "../auth/permissions";
import { auth } from "../auth/auth";

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
  passkey: boolean;
  organization: boolean;
  oidcProvider: boolean;
  /** Assignable role names (access-control), for the admin role picker. */
  roles: string[];
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
      passkey: flags.passkey,
      organization: flags.organization,
      oidcProvider: flags.oidcProvider,
      // Server-enforced flags are boot-time (environment), not live-toggleable.
      providers,
      deleteAccount: process.env.AUTH_ALLOW_DELETE === "true",
      auditLog: process.env.AUDIT_LOG_ENABLED === "true",
      emailVerification: process.env.AUTH_EMAIL_VERIFICATION === "true",
      passwordBreachCheck: process.env.AUTH_HIBP === "true",
      roles: ROLE_NAMES,
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

  // Add an existing user to an organization with a role (e.g. "manager"), so several
  // members can hold it. better-auth's addMember is server-only; this exposes it and
  // delegates org-level authorization to better-auth via the caller's session headers.
  @Post("org-member")
  async addOrgMember(
    @Req() req: Request,
    @Body() body: { organizationId: string; userId: string; role: string },
  ): Promise<unknown> {
    // addMember is a server-only better-auth endpoint (not on the typed public api);
    // it exists at runtime, so reach it through a narrow cast.
    const api = auth.api as unknown as {
      addMember: (opts: { body: { organizationId: string; userId: string; role: string }; headers: Headers }) => Promise<unknown>;
    };
    return api.addMember({
      body: { organizationId: body.organizationId, userId: body.userId, role: body.role },
      headers: fromNodeHeaders(req.headers),
    });
  }
}
