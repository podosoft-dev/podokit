import type { MigrationInterface, QueryRunner } from "typeorm";

export class InitTodos1720100000000 implements MigrationInterface {
  name = "InitTodos1720100000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type === "better-sqlite3") {
      await queryRunner.query(`
        CREATE TABLE "todos" (
          "id" text NOT NULL PRIMARY KEY,
          "title" character varying(500) NOT NULL,
          "completed" boolean NOT NULL DEFAULT false,
          "createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `);
      return;
    }
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      CREATE TABLE "todos" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" character varying(500) NOT NULL,
        "completed" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_todos_id" PRIMARY KEY ("id")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "todos"`);
  }
}
