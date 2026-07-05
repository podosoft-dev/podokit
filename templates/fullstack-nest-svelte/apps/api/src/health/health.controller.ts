import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  liveness(): { status: string; uptime: number; timestamp: string } {
    return {
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
