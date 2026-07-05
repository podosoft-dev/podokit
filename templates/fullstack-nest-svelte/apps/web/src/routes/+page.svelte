<script lang="ts">
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
  <header>
    <h1 class="text-3xl font-bold">{{projectName}}</h1>
    <p class="text-sm opacity-70">Full-stack starter generated with PodoKit.</p>
  </header>

  <form class="flex gap-2" onsubmit={add}>
    <input
      class="flex-1 rounded-md border border-current/20 bg-transparent px-3 py-2 text-sm"
      placeholder="Add a todo…"
      bind:value={title}
    />
    <button class="rounded-md border border-current/20 px-4 py-2 text-sm font-medium hover:opacity-80" type="submit">
      Add
    </button>
  </form>

  {#if error}
    <p class="text-sm text-red-500">{error}</p>
  {/if}

  <ul class="flex flex-col divide-y divide-current/10">
    {#each todos as todo (todo.id)}
      <li class="flex items-center gap-3 py-3">
        <input type="checkbox" checked={todo.completed} onchange={() => toggle(todo)} />
        <span class="flex-1 text-sm" class:line-through={todo.completed} class:opacity-50={todo.completed}>
          {todo.title}
        </span>
        <button class="text-xs opacity-60 hover:opacity-100" onclick={() => remove(todo)}>Delete</button>
      </li>
    {:else}
      <li class="py-6 text-center text-sm opacity-50">No todos yet — add one above.</li>
    {/each}
  </ul>
</main>
