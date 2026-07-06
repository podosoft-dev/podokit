<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import * as Table from "$lib/components/ui/table";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";

  type Session = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: string | Date };
  let sessions = $state<Session[]>([]);

  async function load(): Promise<void> {
    const { data, error } = await api.auth.listSessions();
    if (error) { toast.error(error.message ?? "Failed to load sessions"); return; }
    sessions = (data ?? []) as Session[];
  }

  async function revoke(token: string): Promise<void> {
    const { error } = await api.auth.revokeSession({ token });
    if (error) toast.error(error.message ?? "Failed to revoke");
    else { toast.success("Session revoked"); await load(); }
  }

  $effect(() => { void load(); });
</script>

<div class="flex flex-col gap-4">
  <h1 class="text-2xl font-semibold">Active sessions</h1>
  <div class="rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row><Table.Head>Device</Table.Head><Table.Head>IP</Table.Head><Table.Head>Since</Table.Head><Table.Head class="w-10"></Table.Head></Table.Row>
      </Table.Header>
      <Table.Body>
        {#each sessions as session (session.id)}
          <Table.Row>
            <Table.Cell class="max-w-xs truncate">{session.userAgent ?? "Unknown"}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{session.ipAddress ?? "—"}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{new Date(session.createdAt).toLocaleString()}</Table.Cell>
            <Table.Cell><Button variant="ghost" size="sm" onclick={() => revoke(session.token)}>Revoke</Button></Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row><Table.Cell colspan={4} class="text-muted-foreground py-8 text-center">No active sessions.</Table.Cell></Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</div>
