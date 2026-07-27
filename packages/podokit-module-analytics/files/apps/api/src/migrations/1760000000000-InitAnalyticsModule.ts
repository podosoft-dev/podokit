import { type MigrationInterface, type QueryRunner, Table } from "typeorm";

export class InitAnalyticsModule1760000000000 implements MigrationInterface {
  name = "InitAnalyticsModule1760000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("analytics_config")) return;
    await queryRunner.createTable(
      new Table({
        name: "analytics_config",
        columns: [
          {
            name: "id",
            type: "varchar",
            length: "32",
            isPrimary: true,
          },
          { name: "enabled", type: "boolean", default: false },
          {
            name: "provider",
            type: "varchar",
            length: "32",
            default: "'ga4'",
          },
          {
            name: "measurementId",
            type: "varchar",
            length: "32",
            isNullable: true,
          },
          {
            name: "propertyId",
            type: "varchar",
            length: "32",
            isNullable: true,
          },
          { name: "encryptedCredentials", type: "text", isNullable: true },
          { name: "lastVerifiedAt", type: "timestamptz", isNullable: true },
          { name: "createdAt", type: "timestamptz", default: "now()" },
          { name: "updatedAt", type: "timestamptz", default: "now()" },
        ],
      })
    );
  }

  async down(): Promise<void> {
    // Module removal deliberately keeps encrypted configuration. Drop the table
    // with an application-owned destructive migration when explicitly wanted.
  }
}
