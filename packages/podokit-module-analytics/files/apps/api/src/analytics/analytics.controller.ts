import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  Public,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import { Audit } from "../audit/audit.decorator";
import {
  AnalyticsService,
  type AnalyticsAdminConfig,
  type AnalyticsPublicConfig,
} from "./analytics.service";
import type { AnalyticsRealtime, AnalyticsReport } from "./analytics.types";
import { AnalyticsReportQueryDto } from "./dto/analytics-report-query.dto";
import { UpdateAnalyticsConfigDto } from "./dto/update-analytics-config.dto";

function requireAdmin(session: UserSession): void {
  const role = session.user?.role;
  const roles = Array.isArray(role)
    ? role
    : (role ?? "").split(",").map((candidate: string) => candidate.trim());
  if (!roles.includes("admin")) throw new ForbiddenException("Admins only");
}

@ApiTags("analytics")
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Public()
  @Get("analytics/config")
  publicConfig(): Promise<AnalyticsPublicConfig> {
    return this.analytics.publicConfig();
  }

  @Get("admin/analytics/config")
  adminConfig(@Session() session: UserSession): Promise<AnalyticsAdminConfig> {
    requireAdmin(session);
    return this.analytics.adminConfig();
  }

  @Put("admin/analytics/config")
  @Audit("analytics.config.update")
  update(
    @Session() session: UserSession,
    @Body() body: UpdateAnalyticsConfigDto
  ): Promise<AnalyticsAdminConfig> {
    requireAdmin(session);
    return this.analytics.update(body);
  }

  @Delete("admin/analytics/config/credentials")
  @Audit("analytics.credentials.delete")
  deleteCredentials(
    @Session() session: UserSession
  ): Promise<AnalyticsAdminConfig> {
    requireAdmin(session);
    return this.analytics.deleteCredentials();
  }

  @Post("admin/analytics/config/test")
  @Audit("analytics.connection.verify")
  verify(@Session() session: UserSession): Promise<AnalyticsAdminConfig> {
    requireAdmin(session);
    return this.analytics.verify();
  }

  @Get("admin/analytics/report")
  report(
    @Session() session: UserSession,
    @Query() query: AnalyticsReportQueryDto
  ): Promise<AnalyticsReport> {
    requireAdmin(session);
    return this.analytics.report(query.from, query.to);
  }

  @Get("admin/analytics/realtime")
  realtime(@Session() session: UserSession): Promise<AnalyticsRealtime> {
    requireAdmin(session);
    return this.analytics.realtime();
  }
}
