import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

// Validates the X-API-Key header against the API_KEYS allowlist.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly keys = (process.env.API_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header("x-api-key");
    if (!provided) {
      throw new UnauthorizedException("Missing X-API-Key");
    }
    const supplied = Buffer.from(provided);
    const valid = this.keys.some((key) => {
      const expected = Buffer.from(key);
      return expected.length === supplied.length && timingSafeEqual(expected, supplied);
    });
    if (!valid) {
      throw new UnauthorizedException("Invalid API key");
    }
    return true;
  }
}
