import { Controller, Get } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ApiTags } from "@nestjs/swagger";
import { Repository } from "typeorm";
import { AuditLog } from "./audit-log.entity";

@ApiTags("audit")
@Controller("audit-logs")
export class AuditController {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  @Get()
  recent(): Promise<AuditLog[]> {
    return this.logs.find({ order: { createdAt: "DESC" }, take: 50 });
  }
}
