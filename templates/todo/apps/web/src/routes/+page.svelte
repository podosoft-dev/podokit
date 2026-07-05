<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import * as Card from "$lib/components/ui/card";

  type Todo = { id: string; title: string; completed: boolean };

  let todos = $state<Todo[]>([]);
  let title = $state("");
  let error = $state<string | null>(null);

  async function load(): Promise<void> {
    const res = await fetch("/api/todos");
    if (res.ok) todos = await res.json();
    else error = `Failed to load (HTTP ${res.status})`;
  }

  async function add(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: value }),
    });
    if (res.ok) {
      title = "";
      await load();
    } else {
      error = `Failed to add (HTTP ${res.status})`;
    }
  }

  async function toggle(todo: Todo): Promise<void> {
    await fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed: !todo.completed }),
    });
    await load();
  }

  async function remove(todo: Todo): Promise<void> {
    await fetch(`/api/todos/${todo.id}`, { method: "DELETE" });
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
      <Card.Description>A NestJS + SvelteKit CRUD example.</Card.Description>
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
