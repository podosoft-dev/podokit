<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import * as Card from "$lib/components/ui/card";

  type Health = { status: string } | { error: string };

  let health = $state<Health | null>(null);

  async function check(): Promise<void> {
    const res = await fetch("/api/health");
    health = res.ok ? await res.json() : { error: `HTTP ${res.status}` };
  }
</script>

<main class="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-8">
  <div>
    <h1 class="text-3xl font-bold">{{projectName}}</h1>
    <p class="text-muted-foreground text-sm">Full-stack starter generated with PodoKit.</p>
  </div>

  <Card.Root>
    <Card.Header>
      <Card.Title>API health</Card.Title>
      <Card.Description>Check the NestJS API through the SvelteKit server proxy.</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
      <Button class="w-fit" onclick={check}>Check API health</Button>
      {#if health}
        <pre class="bg-muted rounded-md p-4 text-sm">{JSON.stringify(health, null, 2)}</pre>
      {/if}
    </Card.Content>
  </Card.Root>
</main>
