import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

// One generic, config-driven content collection. `collection` keys the set
// (e.g. "services", "solutions", "portfolio", "team") so a single table backs
// any card-list-to-detail content type. Project-specific fields go in `metadata`
// (jsonb) — no migration needed to extend an item.
@Entity("collection_item")
@Index("IDX_collection_item_collection_order", ["collection", "order"])
@Index("UQ_collection_item_collection_slug", ["collection", "slug"], { unique: true })
export class CollectionItem {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 64 })
  collection!: string;

  @Column({ type: "varchar", length: 200 })
  title!: string;

  @Column({ type: "varchar", length: 200 })
  slug!: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  summary!: string | null;

  @Column({ type: "text", default: "" })
  body!: string;

  @Column({ type: "varchar", length: 100, nullable: true })
  icon!: string | null;

  @Column({ type: "varchar", length: 500, nullable: true })
  image!: string | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  color!: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  category!: string | null;

  @Column({ type: "int", default: 0 })
  order!: number;

  @Column({ type: "varchar", length: 16, default: "draft" })
  status!: "draft" | "published";

  // Project-specific fields, extended without a migration; the managed
  // components ignore unknown keys and owned pages read `item.metadata.*`.
  @Column({ type: "jsonb", default: {} })
  metadata!: Record<string, unknown>;

  @Column({ type: "timestamptz", nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
