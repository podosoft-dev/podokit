<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import * as Table from "$lib/components/ui/table";
  import TablePagination from "$lib/components/table-pagination.svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n, fmt } from "$lib/i18n";
  import type { SessionUser } from "../../../../app.d.ts";

  let { data }: { data: { user: SessionUser; currentSessionId: string | null } } = $props();
  const i18n = getI18n();
  let currentPassword = $state("");
  let newPassword = $state("");
  let loading = $state(false);

  async function changePassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    loading = true;
    const { error } = await api.auth.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    loading = false;
    if (error) toast.error(error.message ?? i18n.t.account.changeFailed);
    else {
      toast.success(i18n.t.account.changed);
      currentPassword = "";
      newPassword = "";
      await loadSessions();
    }
  }

  // Active sessions (this user's own devices)
  type Session = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: string | Date };
  const PAGE_SIZE = 5;
  let sessions = $state<Session[]>([]);
  let sessionsPage = $state(1);
  let sessionsLoading = $state(false);
  let busy = $state(false);
  const pagedSessions = $derived(sessions.slice((sessionsPage - 1) * PAGE_SIZE, sessionsPage * PAGE_SIZE));

  async function loadSessions(): Promise<void> {
    sessionsLoading = true;
    const { data: res, error } = await api.auth.listSessions();
    sessionsLoading = false;
    if (error) {
      toast.error(error.message ?? i18n.t.sessions.loadFailed);
      return;
    }
    sessions = (res ?? []) as Session[];
  }

  async function revoke(token: string): Promise<void> {
    busy = true;
    const { error } = await api.auth.revokeSession({ token });
    busy = false;
    if (error) toast.error(error.message ?? i18n.t.sessions.revokeFailed);
    else {
      toast.success(i18n.t.sessions.revoked);
      await loadSessions();
    }
  }

  async function signOutOthers(): Promise<void> {
    busy = true;
    const { error } = await api.auth.revokeOtherSessions();
    busy = false;
    if (error) toast.error(error.message ?? i18n.t.sessions.revokeFailed);
    else {
      toast.success(i18n.t.sessions.othersRevoked);
      await loadSessions();
    }
  }

  $effect(() => {
    void loadSessions();
  });
</script>

<div class="flex flex-col gap-6">
  <h1 class="text-2xl font-semibold">{i18n.t.account.title}</h1>

  <div class="grid items-start gap-6 lg:grid-cols-2">
    <Card.Root>
      <Card.Header><Card.Title>{i18n.t.account.profile}</Card.Title></Card.Header>
      <Card.Content class="flex flex-col gap-3 text-sm">
        <div class="flex justify-between gap-4"><span class="text-muted-foreground">{i18n.t.account.name}</span><span class="font-medium">{data.user.name}</span></div>
        <div class="flex justify-between gap-4"><span class="text-muted-foreground">{i18n.t.account.email}</span><span class="truncate font-medium">{data.user.email}</span></div>
        <div class="flex justify-between gap-4"><span class="text-muted-foreground">{i18n.t.account.role}</span><span class="font-medium capitalize">{data.user.role ?? "user"}</span></div>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header><Card.Title>{i18n.t.account.changePassword}</Card.Title></Card.Header>
      <Card.Content>
        <form class="flex flex-col gap-4" onsubmit={changePassword}>
          <div class="flex flex-col gap-2">
            <Label for="current">{i18n.t.account.currentPassword}</Label>
            <Input id="current" type="password" bind:value={currentPassword} required autocomplete="current-password" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="new">{i18n.t.account.newPassword}</Label>
            <Input id="new" type="password" bind:value={newPassword} required autocomplete="new-password" />
          </div>
          <Button type="submit" class="w-fit" disabled={loading}>{loading ? i18n.t.account.updating : i18n.t.account.update}</Button>
        </form>
      </Card.Content>
    </Card.Root>
  </div>

  <Card.Root>
    <Card.Header class="flex flex-row items-center justify-between gap-2">
      <Card.Title>{i18n.t.sessions.title}</Card.Title>
      <Button variant="outline" size="sm" disabled={busy || sessions.length <= 1} onclick={signOutOthers}>
        {i18n.t.sessions.signOutOthers}
      </Button>
    </Card.Header>
    <Card.Content>
      <div class="rounded-md border">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{i18n.t.sessions.device}</Table.Head>
              <Table.Head>{i18n.t.sessions.ip}</Table.Head>
              <Table.Head>{i18n.t.sessions.since}</Table.Head>
              <Table.Head>{i18n.t.sessions.status}</Table.Head>
              <Table.Head class="w-10"></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each pagedSessions as session (session.id)}
              {@const isCurrent = session.id === data.currentSessionId}
              <Table.Row>
                <Table.Cell class="max-w-xs truncate">{session.userAgent ?? i18n.t.sessions.unknown}</Table.Cell>
                <Table.Cell class="text-muted-foreground">{session.ipAddress ?? "—"}</Table.Cell>
                <Table.Cell class="text-muted-foreground">{new Date(session.createdAt).toLocaleString(i18n.locale)}</Table.Cell>
                <Table.Cell>{#if isCurrent}<Badge>{i18n.t.sessions.current}</Badge>{/if}</Table.Cell>
                <Table.Cell>
                  <Button variant="ghost" size="sm" disabled={busy || isCurrent} onclick={() => revoke(session.token)}>
                    {i18n.t.sessions.revoke}
                  </Button>
                </Table.Cell>
              </Table.Row>
            {:else}
              <Table.Row><Table.Cell colspan={5} class="text-muted-foreground py-8 text-center">{sessionsLoading ? "…" : i18n.t.sessions.empty}</Table.Cell></Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
      <div class="mt-4">
        <TablePagination
          count={sessions.length}
          perPage={PAGE_SIZE}
          bind:page={sessionsPage}
          label={fmt(i18n.t.sessions.total, { count: sessions.length })}
        />
      </div>
    </Card.Content>
  </Card.Root>
</div>
