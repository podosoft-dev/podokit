import type { MigrationInterface, QueryRunner } from "typeorm";

export class InitBlog1720800000000 implements MigrationInterface {
  name = "InitBlog1720800000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      CREATE TABLE "post" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" character varying(200) NOT NULL,
        "slug" character varying(200) NOT NULL,
        "excerpt" character varying(500),
        "body" text NOT NULL DEFAULT '',
        "coverImage" character varying(500),
        "author" character varying(200),
        "tags" jsonb NOT NULL DEFAULT '[]',
        "status" character varying(16) NOT NULL DEFAULT 'draft',
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "publishedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_post_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_post_slug" ON "post" ("slug")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_post_status_publishedAt" ON "post" ("status", "publishedAt")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_post_status_publishedAt"`);
    await queryRunner.query(`DROP INDEX "UQ_post_slug"`);
    await queryRunner.query(`DROP TABLE "post"`);
  }
}
