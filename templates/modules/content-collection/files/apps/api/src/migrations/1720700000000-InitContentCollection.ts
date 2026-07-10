import type { MigrationInterface, QueryRunner } from "typeorm";

export class InitContentCollection1720700000000 implements MigrationInterface {
  name = "InitContentCollection1720700000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      CREATE TABLE "collection_item" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "collection" character varying(64) NOT NULL,
        "title" character varying(200) NOT NULL,
        "slug" character varying(200) NOT NULL,
        "summary" character varying(500),
        "body" text NOT NULL DEFAULT '',
        "icon" character varying(100),
        "image" character varying(500),
        "color" character varying(32),
        "category" character varying(100),
        "order" integer NOT NULL DEFAULT 0,
        "status" character varying(16) NOT NULL DEFAULT 'draft',
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "publishedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_collection_item_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_collection_item_collection_order" ON "collection_item" ("collection", "order")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_collection_item_collection_slug" ON "collection_item" ("collection", "slug")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_collection_item_collection_slug"`);
    await queryRunner.query(`DROP INDEX "IDX_collection_item_collection_order"`);
    await queryRunner.query(`DROP TABLE "collection_item"`);
  }
}
