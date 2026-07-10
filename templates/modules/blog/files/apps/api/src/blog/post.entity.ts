import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

// A blog post. Project-specific fields go in `metadata` (jsonb) — no migration
// needed to extend a post; managed components ignore unknown keys.
@Entity("post")
@Index("IDX_post_status_publishedAt", ["status", "publishedAt"])
export class Post {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 200 })
  title!: string;

  @Index("UQ_post_slug", { unique: true })
  @Column({ type: "varchar", length: 200 })
  slug!: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  excerpt!: string | null;

  @Column({ type: "text", default: "" })
  body!: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  coverImage!: string | null;

  @Column({ type: "varchar", length: 200, nullable: true })
  author!: string | null;

  @Column({ type: "jsonb", default: [] })
  tags!: string[];

  @Column({ type: "varchar", length: 16, default: "draft" })
  status!: "draft" | "published";

  @Column({ type: "jsonb", default: {} })
  metadata!: Record<string, unknown>;

  @Column({ type: "timestamptz", nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
