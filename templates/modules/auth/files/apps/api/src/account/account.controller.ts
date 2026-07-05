import { Controller, Get } from "@nestjs/common";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { ApiTags } from "@nestjs/swagger";

// Protected by the global AuthGuard. Use @Session() to read the current user.
@ApiTags("account")
@Controller("account")
export class AccountController {
  @Get("me")
  me(@Session() session: UserSession) {
    return session.user;
  }
}
