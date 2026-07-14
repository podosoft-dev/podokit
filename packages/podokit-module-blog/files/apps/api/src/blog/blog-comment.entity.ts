import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("blog_comments")
@Index(["postId", "createdAt"])
export class BlogComment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  postId!: string;

  @Index()
  @Column({ type: "varchar", length: 255, nullable: true })
  authorId!: string | null;

  @Column({ type: "varchar", length: 200, default: "" })
  author!: string;

  @Column({ type: "varchar", length: 1000, nullable: true })
  authorImage!: string | null;

  @Column({ type: "text" })
  body!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
