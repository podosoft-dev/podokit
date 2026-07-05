import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { TodosService } from "./todos.service";
import { CreateTodoDto } from "./dto/create-todo.dto";
import { UpdateTodoDto } from "./dto/update-todo.dto";
import { Todo } from "./todo.entity";

@ApiTags("todos")
@Controller("todos")
export class TodosController {
  constructor(private readonly todos: TodosService) {}

  @Get()
  findAll(): Promise<Todo[]> {
    return this.todos.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string): Promise<Todo> {
    return this.todos.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTodoDto): Promise<Todo> {
    return this.todos.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateTodoDto): Promise<Todo> {
    return this.todos.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id") id: string): Promise<void> {
    return this.todos.remove(id);
  }
}
