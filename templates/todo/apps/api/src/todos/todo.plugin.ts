import { AppException } from "@podosoft/podokit-contracts";
import { Elysia, t } from "elysia";
import type { AppPlugin } from "../core/services";
import { TodoRepository } from "./todo.repository";

const todoSchema = t.Object({
  id: t.String({ format: "uuid" }),
  title: t.String(),
  completed: t.Boolean(),
  createdAt: t.String(),
});

export const todoPlugin: AppPlugin = ({ database }) => {
  const todos = new TodoRepository(database.sql);
  return new Elysia({ name: "podokit.todos" })
    .get("/todos", () => todos.all(), {
      response: t.Array(todoSchema),
      detail: { tags: ["todos"], summary: "List todos" },
    })
    .get("/todos/:id", async ({ params }) => {
      const todo = await todos.find(params.id);
      if (!todo) throw new AppException("TODO_NOT_FOUND", `Todo ${params.id} not found`, 404);
      return todo;
    }, {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: todoSchema,
      detail: { tags: ["todos"], summary: "Get a todo" },
    })
    .post("/todos", ({ body, set }) => {
      set.status = 201;
      return todos.create(body.title);
    }, {
      body: t.Object({ title: t.String({ minLength: 1, maxLength: 500 }) }),
      response: todoSchema,
      detail: { tags: ["todos"], summary: "Create a todo" },
    })
    .patch("/todos/:id", async ({ params, body }) => {
      const todo = await todos.update(params.id, body);
      if (!todo) throw new AppException("TODO_NOT_FOUND", `Todo ${params.id} not found`, 404);
      return todo;
    }, {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        title: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
        completed: t.Optional(t.Boolean()),
      }),
      response: todoSchema,
      detail: { tags: ["todos"], summary: "Update a todo" },
    })
    .delete("/todos/:id", async ({ params, set }) => {
      if (!(await todos.remove(params.id))) {
        throw new AppException("TODO_NOT_FOUND", `Todo ${params.id} not found`, 404);
      }
      set.status = 204;
    }, {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: { tags: ["todos"], summary: "Delete a todo" },
    });
};
