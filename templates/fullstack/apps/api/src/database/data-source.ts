import "dotenv/config";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DataSource, type DataSourceOptions } from "typeorm";

const compiledMigrations = join(process.cwd(), "dist", "migrations");
const migrations = existsSync(compiledMigrations)
  ? [join(compiledMigrations, "[0-9]*.js")]
  : [join(process.cwd(), "src", "migrations", "[0-9]*.ts")];

export const dataSourceOptions: DataSourceOptions = {
  type: "postgres",
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? "podokit",
  password: process.env.POSTGRES_PASSWORD ?? "podokit",
  database: process.env.POSTGRES_DB ?? "podokit",
  entities: [],
  migrations,
  synchronize: false,
};

// Used by the TypeORM CLI for migrations (see package.json scripts).
export default new DataSource(dataSourceOptions);
