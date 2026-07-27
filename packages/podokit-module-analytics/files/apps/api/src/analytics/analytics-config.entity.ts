import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "analytics_config" })
export class AnalyticsConfig {
  @PrimaryColumn({ type: "varchar", length: 32 })
  id!: string;

  @Column({ type: "boolean", default: false })
  enabled!: boolean;

  @Column({ type: "varchar", length: 32, default: "ga4" })
  provider!: "ga4";

  @Column({ type: "varchar", length: 32, nullable: true })
  measurementId!: string | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  propertyId!: string | null;

  @Column({ type: "text", nullable: true })
  encryptedCredentials!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  lastVerifiedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
