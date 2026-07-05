<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import * as Card from "$lib/components/ui/card";
  import { api } from "$lib/api";
  import { ApiError } from "@podosoft/podokit-api-client";

  type Todo = { id: string; title: string; completed: boolean };

  let todos = $state<Todo[]>([]);
  let title = $state("");
  let error = $state<string | null>(null);

  function fail(err: unknown, action: string): void {
    error = err instanceof ApiError ? `${action}: ${err.message}` : `${action} failed`;
  }

  async function load(): Promise<void> {
    try {
      todos = await api.get<Todo[]>("/todos");
      error = null;
    } catch (err) {
      fail(err, "Load");
    }
  }

  async function add(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    try {
      await api.post("/todos", { title: value });
      title = "";
      await load();
    } catch (err) {
      fail(err, "Add");
    }
  }

  async function toggle(todo: Todo): Promise<void> {
    await api.patch(`/todos/${todo.id}`, { completed: !todo.completed });
    await load();
  }

  async function remove(todo: Todo): Promise<void> {
    await api.del(`/todos/${todo.id}`);
    await load();
  }

  $effect(() => {
    void load();
  });
</script>

<main class="mx-auto flex min-h-full max-w-xl flex-col gap-6 p-8">
  <div>
    <h1 class="text-3xl font-bold">{{projectName}}</h1>
    <p class="text-muted-foreground text-sm">Full-stack starter generated with PodoKit.</p>
  </div>

  <Card.Root>
    <Card.Header>
      <Card.Title>Todos</Card.Title>
      <Card.Description>A NestJS + SvelteKit CRUD example via the typed ApiClient.</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
      <form class="flex gap-2" onsubmit={add}>
        <Input placeholder="Add a todo…" bind:value={title} />
        <Button type="submit">Add</Button>
      </form>

      {#if error}
        <p class="text-destructive text-sm">{error}</p>
      {/if}

      <ul class="divide-border flex flex-col divide-y">
        {#each todos as todo (todo.id)}
          <li class="flex items-center gap-3 py-3">
            <Checkbox checked={todo.completed} onCheckedChange={() => toggle(todo)} />
            <span
              class="flex-1 text-sm"
              class:line-through={todo.completed}
              class:text-muted-foreground={todo.completed}
            >
              {todo.title}
            </span>
            <Button variant="ghost" size="sm" onclick={() => remove(todo)}>Delete</Button>
          </li>
        {:else}
          <li class="text-muted-foreground py-6 text-center text-sm">No todos yet — add one above.</li>
        {/each}
      </ul>
    </Card.Content>
  </Card.Root>
</main>
