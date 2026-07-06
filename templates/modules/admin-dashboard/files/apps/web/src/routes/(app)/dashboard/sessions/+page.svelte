<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import * as Table from "$lib/components/ui/table";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n } from "$lib/i18n";

  const i18n = getI18n();
  type Session = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: string | Date };
  let sessions = $state<Session[]>([]);

  async function load(): Promise<void> {
    const { data, error } = await api.auth.listSessions();
    if (error) { toast.error(error.message ?? i18n.t.sessions.loadFailed); return; }
    sessions = (data ?? []) as Session[];
  }

  async function revoke(token: string): Promise<void> {
    const { error } = await api.auth.revokeSession({ token });
    if (error) toast.error(error.message ?? i18n.t.sessions.revokeFailed);
    else { toast.success(i18n.t.sessions.revoked); await load(); }
  }

  $effect(() => { void load(); });
</script>

<div class="flex flex-col gap-4">
  <h1 class="text-2xl font-semibold">{i18n.t.sessions.title}</h1>
  <div class="rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row><Table.Head>{i18n.t.sessions.device}</Table.Head><Table.Head>{i18n.t.sessions.ip}</Table.Head><Table.Head>{i18n.t.sessions.since}</Table.Head><Table.Head class="w-10"></Table.Head></Table.Row>
      </Table.Header>
      <Table.Body>
        {#each sessions as session (session.id)}
          <Table.Row>
            <Table.Cell class="max-w-xs truncate">{session.userAgent ?? i18n.t.sessions.unknown}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{session.ipAddress ?? "—"}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{new Date(session.createdAt).toLocaleString(i18n.locale)}</Table.Cell>
            <Table.Cell><Button variant="ghost" size="sm" onclick={() => revoke(session.token)}>{i18n.t.sessions.revoke}</Button></Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row><Table.Cell colspan={4} class="text-muted-foreground py-8 text-center">{i18n.t.sessions.empty}</Table.Cell></Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</div>
