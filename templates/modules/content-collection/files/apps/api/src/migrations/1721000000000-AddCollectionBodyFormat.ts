import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddCollectionBodyFormat1721000000000 implements MigrationInterface {
  name = "AddCollectionBodyFormat1721000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "collection_item" ADD COLUMN IF NOT EXISTS "bodyFormat" character varying(16) NOT NULL DEFAULT 'markdown'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "collection_item" DROP COLUMN IF EXISTS "bodyFormat"`);
  }
}
