import type { MigrationInterface, QueryRunner } from "typeorm";

export class InitFaq1720900000000 implements MigrationInterface {
  name = "InitFaq1720900000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      CREATE TABLE "faq_item" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "question" character varying(500) NOT NULL,
        "answer" text NOT NULL DEFAULT '',
        "category" character varying(100) NOT NULL DEFAULT 'General',
        "order" integer NOT NULL DEFAULT 0,
        "published" boolean NOT NULL DEFAULT false,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_faq_item_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_faq_item_category_order" ON "faq_item" ("category", "order")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_faq_item_category_order"`);
    await queryRunner.query(`DROP TABLE "faq_item"`);
  }
}
