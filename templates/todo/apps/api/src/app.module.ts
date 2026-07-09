import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { validateEnv } from "./config/env.validation";
import { dataSourceOptions } from "./database/data-source";
import { HealthModule } from "./health/health.module";
import { TodosModule } from "./todos/todos.module";
// podokit:begin:imports
// podokit:end:imports

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRoot(dataSourceOptions),
    HealthModule,
    TodosModule,
    // podokit:begin:module-imports
    // podokit:end:module-imports
  ],
  providers: [
    // podokit:begin:providers
    // podokit:end:providers
  ],
})
export class AppModule {}
