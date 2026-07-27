import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AnalyticsConfig } from "./analytics-config.entity";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { Ga4AnalyticsProvider } from "./ga4-analytics.provider";

@Module({
  imports: [TypeOrmModule.forFeature([AnalyticsConfig])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, Ga4AnalyticsProvider],
  exports: [AnalyticsService, Ga4AnalyticsProvider],
})
export class AnalyticsModule {}
