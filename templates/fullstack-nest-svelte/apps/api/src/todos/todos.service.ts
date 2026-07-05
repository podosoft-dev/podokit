import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Todo } from "./todo.entity";
import { CreateTodoDto } from "./dto/create-todo.dto";
import { UpdateTodoDto } from "./dto/update-todo.dto";

@Injectable()
export class TodosService {
  constructor(
    @InjectRepository(Todo)
    private readonly todos: Repository<Todo>,
  ) {}

  findAll(): Promise<Todo[]> {
    return this.todos.find({ order: { createdAt: "DESC" } });
  }

  async findOne(id: string): Promise<Todo> {
    const todo = await this.todos.findOne({ where: { id } });
    if (!todo) {
      throw new NotFoundException(`Todo ${id} not found`);
    }
    return todo;
  }

  create(dto: CreateTodoDto): Promise<Todo> {
    return this.todos.save(this.todos.create(dto));
  }

  async update(id: string, dto: UpdateTodoDto): Promise<Todo> {
    const todo = await this.findOne(id);
    Object.assign(todo, dto);
    return this.todos.save(todo);
  }

  async remove(id: string): Promise<void> {
    const todo = await this.findOne(id);
    await this.todos.remove(todo);
  }
}
