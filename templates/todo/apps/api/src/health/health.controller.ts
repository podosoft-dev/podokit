import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

@Controller("health")
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  liveness(): { status: string; uptime: number; timestamp: string } {
    return { status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() };
  }

  @Get("ready")
  async readiness(): Promise<{ status: string; db: string }> {
    try {
      await this.dataSource.query("SELECT 1");
      return { status: "ready", db: "up" };
    } catch {
      throw new ServiceUnavailableException({ status: "degraded", db: "down" });
    }
  }
}
