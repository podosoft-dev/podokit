import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { fromNodeHeaders } from "better-auth/node";
import type { Request, Response } from "express";
import { type Observable, tap } from "rxjs";
import { Repository } from "typeorm";
import { auth } from "../auth/auth";
import { AuditLog } from "./audit-log.entity";

const AUDITED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Records who performed each mutating request. Skips the auth endpoints.
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
    return next.handle().pipe(tap(() => void this.record(req, res, path)));
  }

  private async record(req: Request, res: Response, path: string): Promise<void> {
    let userId: string | null = null;
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      userId = session?.user?.id ?? null;
    } catch {
      userId = null;
    }
    await this.logs.save(
      this.logs.create({ userId, method: req.method, path, statusCode: res.statusCode, ip: req.ip ?? null }),
    );
  }
}
