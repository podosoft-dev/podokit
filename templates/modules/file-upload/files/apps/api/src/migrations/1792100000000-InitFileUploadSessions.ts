import type { MigrationInterface, QueryRunner } from "typeorm";

export class InitFileUploadSessions1792100000000 implements MigrationInterface {
  name = "InitFileUploadSessions1792100000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    const sqlite = queryRunner.connection.options.type === "better-sqlite3";
    const id = sqlite ? "text" : "uuid";
    const timestamp = sqlite ? "text" : "TIMESTAMP WITH TIME ZONE";
    await queryRunner.query(`
      CREATE TABLE "file_upload_sessions" (
        "id" ${id} NOT NULL,
        "ownerId" character varying(128),
        "objectKey" character varying(1024) NOT NULL,
        "multipartUploadId" character varying(1024),
        "filename" character varying(255) NOT NULL,
        "contentType" character varying(255),
        "size" bigint NOT NULL,
        "partSize" bigint NOT NULL,
        "partCount" integer NOT NULL,
        "status" character varying(16) NOT NULL,
        "expiresAt" ${timestamp} NOT NULL,
        "createdAt" ${timestamp} NOT NULL,
        "updatedAt" ${timestamp} NOT NULL,
        CONSTRAINT "PK_file_upload_sessions_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_file_upload_sessions_status_expiresAt" ON "file_upload_sessions" ("status", "expiresAt")`,
    );
    await queryRunner.query(`
      CREATE TABLE "file_upload_parts" (
        "sessionId" ${id} NOT NULL,
        "partNumber" integer NOT NULL,
        "etag" character varying(1024) NOT NULL,
        "size" bigint NOT NULL,
        "updatedAt" ${timestamp} NOT NULL,
        CONSTRAINT "PK_file_upload_parts" PRIMARY KEY ("sessionId", "partNumber"),
        CONSTRAINT "FK_file_upload_parts_sessionId" FOREIGN KEY ("sessionId")
          REFERENCES "file_upload_sessions" ("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "file_upload_parts"`);
    await queryRunner.query(`DROP TABLE "file_upload_sessions"`);
  }
}
