<script lang="ts">
  type Health = { status: string } | { error: string };

  let health = $state<Health | null>(null);

  async function check(): Promise<void> {
    const res = await fetch("/api/health");
    health = res.ok ? await res.json() : { error: `HTTP ${res.status}` };
  }
</script>

<main class="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-8">
  <h1 class="text-3xl font-bold">{{projectName}}</h1>
  <p class="text-sm opacity-70">Full-stack starter generated with PodoKit.</p>

  <button
    class="w-fit rounded-md border border-current/20 px-4 py-2 text-sm font-medium hover:opacity-80"
    onclick={check}
  >
    Check API health
  </button>

  {#if health}
    <pre class="rounded-md bg-current/5 p-4 text-sm">{JSON.stringify(health, null, 2)}</pre>
  {/if}
</main>
