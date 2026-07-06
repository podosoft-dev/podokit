import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { fromNodeHeaders } from "better-auth/node";
import type { Request, Response } from "express";
import { type Observable, tap } from "rxjs";
import { Repository } from "typeorm";
import { auth } from "../auth/auth";
import { AuditLog } from "./audit-log.entity";

const AUDITED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Records who performed each mutating request to the app's own NestJS routes.
// The auth endpoints (/api/auth/*) are mounted as middleware and bypass this
// interceptor entirely — those are audited by the better-auth hook (audit-hook.ts).
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.originalUrl ?? req.url;
    if (!AUDITED_METHODS.has(req.method) || path.startsWith("/api/auth")) {
      return next.handle();
    }
    const res = context.switchToHttp().getResponse<Response>();
    // Record both successful and failed mutations (fire-and-forget; a failed
    // audit write is swallowed so it never breaks the request).
    return next.handle().pipe(
      tap({
        next: () => void this.record(req, res.statusCode, path),
        error: (err: { status?: number }) => void this.record(req, err?.status ?? 500, path),
      }),
    );
  }

  private async record(req: Request, statusCode: number, path: string): Promise<void> {
    try {
      let userId: string | null = null;
      try {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
        userId = session?.user?.id ?? null;
      } catch {
        userId = null;
      }
      await this.logs.save(
        this.logs.create({ userId, method: req.method, path, statusCode, ip: req.ip ?? null }),
      );
    } catch {
      // Never let an audit write failure surface as an unhandled rejection.
    }
  }
}
