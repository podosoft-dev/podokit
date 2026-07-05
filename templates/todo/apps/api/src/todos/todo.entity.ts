import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("todos")
export class Todo {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 500 })
  title!: string;

  @Column({ type: "boolean", default: false })
  completed!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
