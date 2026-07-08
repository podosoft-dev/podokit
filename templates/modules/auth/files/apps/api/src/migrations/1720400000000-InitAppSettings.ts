import type { MigrationInterface, QueryRunner } from "typeorm";

export class InitAppSettings1720400000000 implements MigrationInterface {
  name = "InitAppSettings1720400000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "app_setting" (
        "key" text NOT NULL,
        "value" text NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_app_setting_key" PRIMARY KEY ("key")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "app_setting"`);
  }
}
