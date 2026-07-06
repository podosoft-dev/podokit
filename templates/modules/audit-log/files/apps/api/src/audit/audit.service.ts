import { Injectable, type OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuditLog } from "./audit-log.entity";
import { setAuditRecorder, type AuditEntry } from "./audit-events";

// The one place audit entries are written. Inject it to record events from your
// own Nest code, or call recordAudit() from anywhere else — both end up here.
@Injectable()
export class AuditService implements OnModuleInit {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  onModuleInit(): void {
    setAuditRecorder((entry) => this.record(entry));
  }

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.logs.save(
        this.logs.create({
          userId: entry.userId ?? null,
          method: entry.method,
          path: entry.path,
          statusCode: entry.statusCode,
          ip: entry.ip ?? null,
          metadata: entry.metadata ?? null,
        }),
      );
    } catch {
      // An audit write must never break the request it describes.
    }
  }
}
