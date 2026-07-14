import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type BlogPostStatus = "draft" | "published";

@Entity("blog_posts")
@Index(["status", "publishedAt"])
export class BlogPost {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 300 })
  title!: string;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 300 })
  slug!: string;

  @Column({ type: "text", default: "" })
  excerpt!: string;

  @Column({ type: "text", default: "" })
  body!: string;

  @Column({ type: "varchar", length: 1000, nullable: true })
  coverImage!: string | null;

  @Index()
  @Column({ type: "varchar", length: 255, nullable: true })
  authorId!: string | null;

  @Column({ type: "varchar", length: 200, default: "" })
  author!: string;

  @Column({ type: "varchar", length: 1000, nullable: true })
  authorImage!: string | null;

  @Column({ type: "jsonb", default: () => "'[]'" })
  tags!: string[];

  @Column({ type: "varchar", length: 20, default: "draft" })
  status!: BlogPostStatus;

  @Column({ type: "timestamptz", nullable: true })
  publishedAt!: Date | null;

  @Column({ type: "jsonb", default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
