import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { validateEnv } from "./config/env.validation";
import { dataSourceOptions } from "./database/data-source";
import { HealthModule } from "./health/health.module";
import { extensionImports, extensionProviders } from "./app.extensions";
// podokit:begin:imports
// podokit:end:imports

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRoot(dataSourceOptions),
    HealthModule,
    // podokit:begin:module-imports
    // podokit:end:module-imports
    ...extensionImports,
  ],
  providers: [
    // podokit:begin:providers
    // podokit:end:providers
    ...extensionProviders,
  ],
})
export class AppModule {}
