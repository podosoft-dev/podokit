import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { validateEnv } from "./config/env.validation";
import { dataSourceOptions } from "./database/data-source";
import { HealthModule } from "./health/health.module";
// podokit:imports

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRoot(dataSourceOptions),
    HealthModule,
    // podokit:module-imports
  ],
})
export class AppModule {}
