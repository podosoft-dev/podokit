import { Controller, Get } from "@nestjs/common";
import { Public, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { ApiTags } from "@nestjs/swagger";

type Capabilities = {
  twoFactor: boolean;
  providers: string[];
  deleteAccount: boolean;
  auditLog: boolean;
  emailVerification: boolean;
  passwordBreachCheck: boolean;
  magicLink: boolean;
};

// Protected by the global AuthGuard. Use @Session() to read the current user.
@ApiTags("account")
@Controller("account")
export class AccountController {
  @Get("me")
  me(@Session() session: UserSession) {
    return session.user;
  }

  // Which optional auth features are enabled, so the UI can show/hide sections.
  // Public so the login page (unauthenticated) can offer available sign-in methods.
  @Public()
  @Get("capabilities")
  capabilities(): Capabilities {
    const providers = [
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "google" : null,
      process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET ? "github" : null,
    ].filter((p): p is string => p !== null);
    return {
      twoFactor: process.env.AUTH_TWO_FACTOR === "true",
      providers,
      deleteAccount: process.env.AUTH_ALLOW_DELETE === "true",
      auditLog: process.env.AUDIT_LOG_ENABLED === "true",
      emailVerification: process.env.AUTH_EMAIL_VERIFICATION === "true",
      passwordBreachCheck: process.env.AUTH_HIBP === "true",
      magicLink: process.env.AUTH_MAGIC_LINK === "true",
    };
  }
}
