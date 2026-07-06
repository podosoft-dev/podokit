import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { type Observable, tap } from "rxjs";
import { auth } from "../auth/auth";
import { AuditService } from "./audit.service";

const AUDITED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Records mutating requests to the app's own NestJS routes. The auth endpoints
// (/api/auth/*) are mounted as middleware and bypass this interceptor entirely —
// those are recorded by the better-auth hook (audit-hook.ts). Both funnel into
// AuditService, so every entry shares one shape and one write path.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.originalUrl ?? req.url;
    if (!AUDITED_METHODS.has(req.method) || path.startsWith("/api/auth")) {
      return next.handle();
    }
    const res = context.switchToHttp().getResponse<{ statusCode: number }>();
    return next.handle().pipe(
      tap({
        next: () => void this.log(req, res.statusCode, path),
        error: (err: { status?: number }) => void this.log(req, err?.status ?? 500, path),
      }),
    );
  }

  private async log(req: Request, statusCode: number, path: string): Promise<void> {
    let userId: string | null = null;
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      userId = session?.user?.id ?? null;
    } catch {
      userId = null;
    }
    await this.audit.record({ userId, method: req.method, path, statusCode, ip: req.ip ?? null });
  }
}
