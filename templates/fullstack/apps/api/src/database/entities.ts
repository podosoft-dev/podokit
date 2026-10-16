import type { DataSourceOptions } from "typeorm";

// This owned file is never overwritten by `podo update`. List the
// application's TypeORM entities here: the migration data source loads them,
// so `migration:generate` compares them with the database and code that uses
// `appDataSource` gets their repositories. For example:
//
//   import { Invoice } from "../invoices/invoice.entity";
//   export const APP_ENTITIES: AppEntities = [Invoice];
export type AppEntities = NonNullable<DataSourceOptions["entities"]>;

export const APP_ENTITIES: AppEntities = [];
