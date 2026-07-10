import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

// One FAQ entry. Project-specific fields go in `metadata` (jsonb) — no migration.
@Entity("faq_item")
@Index("IDX_faq_item_category_order", ["category", "order"])
export class FaqItem {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 500 })
  question!: string;

  @Column({ type: "text", default: "" })
  answer!: string;

  @Column({ type: "varchar", length: 100, default: "General" })
  category!: string;

  @Column({ type: "int", default: 0 })
  order!: number;

  @Column({ type: "boolean", default: false })
  published!: boolean;

  @Column({ type: "jsonb", default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
