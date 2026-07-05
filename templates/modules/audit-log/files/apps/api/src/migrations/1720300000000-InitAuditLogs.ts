import type { MigrationInterface, QueryRunner } from "typeorm";

export class InitAuditLogs1720300000000 implements MigrationInterface {
  name = "InitAuditLogs1720300000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" character varying,
        "method" character varying(10) NOT NULL,
        "path" character varying(2048) NOT NULL,
        "statusCode" integer NOT NULL,
        "ip" character varying,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
