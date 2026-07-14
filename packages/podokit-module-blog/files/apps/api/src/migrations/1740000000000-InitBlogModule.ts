import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from "typeorm";

export class InitBlogModule1740000000000 implements MigrationInterface {
  name = "InitBlogModule1740000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    if (!(await queryRunner.hasTable("blog_posts"))) {
      await queryRunner.createTable(
        new Table({
          name: "blog_posts",
          columns: [
            { name: "id", type: "uuid", isPrimary: true, default: "gen_random_uuid()" },
            { name: "title", type: "varchar", length: "300" },
            { name: "slug", type: "varchar", length: "300", isUnique: true },
            { name: "excerpt", type: "text", default: "''" },
            { name: "body", type: "text", default: "''" },
            { name: "coverImage", type: "varchar", length: "1000", isNullable: true },
            { name: "authorId", type: "varchar", length: "255", isNullable: true },
            { name: "author", type: "varchar", length: "200", default: "''" },
            { name: "authorImage", type: "varchar", length: "1000", isNullable: true },
            { name: "tags", type: "jsonb", default: "'[]'" },
            { name: "status", type: "varchar", length: "20", default: "'draft'" },
            { name: "publishedAt", type: "timestamptz", isNullable: true },
            { name: "metadata", type: "jsonb", default: "'{}'" },
            { name: "createdAt", type: "timestamptz", default: "now()" },
            { name: "updatedAt", type: "timestamptz", default: "now()" },
          ],
        }),
      );
    } else {
      await this.addColumn(queryRunner, "authorId", "varchar", { length: "255", isNullable: true });
      await this.addColumn(queryRunner, "authorImage", "varchar", { length: "1000", isNullable: true });
    }

    const posts = await queryRunner.getTable("blog_posts");
    if (posts && !posts.indices.some((index) => index.name === "IDX_blog_posts_status_publishedAt")) {
      await queryRunner.createIndex(
        "blog_posts",
        new TableIndex({ name: "IDX_blog_posts_status_publishedAt", columnNames: ["status", "publishedAt"] }),
      );
    }
    if (posts && !posts.indices.some((index) => index.name === "IDX_blog_posts_authorId")) {
      await queryRunner.createIndex(
        "blog_posts",
        new TableIndex({ name: "IDX_blog_posts_authorId", columnNames: ["authorId"] }),
      );
    }
    await this.addUserForeignKey(queryRunner, "blog_posts", "authorId", "FK_blog_posts_author");

    if (!(await queryRunner.hasTable("blog_comments"))) {
      await queryRunner.createTable(
        new Table({
          name: "blog_comments",
          columns: [
            { name: "id", type: "uuid", isPrimary: true, default: "gen_random_uuid()" },
            { name: "postId", type: "uuid" },
            { name: "authorId", type: "varchar", length: "255", isNullable: true },
            { name: "author", type: "varchar", length: "200", default: "''" },
            { name: "authorImage", type: "varchar", length: "1000", isNullable: true },
            { name: "body", type: "text" },
            { name: "createdAt", type: "timestamptz", default: "now()" },
            { name: "updatedAt", type: "timestamptz", default: "now()" },
          ],
          foreignKeys: [
            {
              name: "FK_blog_comments_post",
              columnNames: ["postId"],
              referencedTableName: "blog_posts",
              referencedColumnNames: ["id"],
              onDelete: "CASCADE",
            },
          ],
          indices: [
            { name: "IDX_blog_comments_post_createdAt", columnNames: ["postId", "createdAt"] },
            { name: "IDX_blog_comments_authorId", columnNames: ["authorId"] },
          ],
        }),
      );
    }
    await this.addUserForeignKey(queryRunner, "blog_comments", "authorId", "FK_blog_comments_author");
  }

  async down(): Promise<void> {
    // Module removal deliberately leaves blog data intact. Use an app-owned
    // destructive migration when a project explicitly wants to remove it.
  }

  private async addColumn(
    queryRunner: QueryRunner,
    name: string,
    type: string,
    options: { length: string; isNullable: boolean },
  ): Promise<void> {
    if (!(await queryRunner.hasColumn("blog_posts", name))) {
      await queryRunner.addColumn("blog_posts", new TableColumn({ name, type, ...options }));
    }
  }

  private async addUserForeignKey(
    queryRunner: QueryRunner,
    tableName: string,
    columnName: string,
    name: string,
  ): Promise<void> {
    if (!(await queryRunner.hasTable("user"))) return;
    const table = await queryRunner.getTable(tableName);
    if (!table || table.foreignKeys.some((foreignKey) => foreignKey.name === name)) return;
    await queryRunner.createForeignKey(
      tableName,
      new TableForeignKey({
        name,
        columnNames: [columnName],
        referencedTableName: "user",
        referencedColumnNames: ["id"],
        onDelete: "SET NULL",
      }),
    );
  }
}
