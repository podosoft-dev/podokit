import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("audit_logs")
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", nullable: true })
  userId!: string | null;

  @Column({ type: "varchar", length: 10 })
  method!: string;

  @Column({ type: "varchar", length: 2048 })
  path!: string;

  @Column({ type: "int" })
  statusCode!: number;

  @Column({ type: "varchar", nullable: true })
  ip!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
