<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Badge } from "$lib/components/ui/badge";
  import * as Table from "$lib/components/ui/table";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n, fmt } from "$lib/i18n";

  const i18n = getI18n();

  type Row = { id: string; name: string; email: string; role?: string | null; banned?: boolean | null };

  const PAGE_SIZE = 10;
  let users = $state<Row[]>([]);
  let total = $state(0);
  let offset = $state(0);
  let search = $state("");
  let loading = $state(false);

  async function load(): Promise<void> {
    loading = true;
    const { data, error } = await api.auth.admin.listUsers({
      query: {
        limit: PAGE_SIZE,
        offset,
        ...(search ? { searchField: "email", searchOperator: "contains", searchValue: search } : {}),
      },
    });
    loading = false;
    if (error) {
      toast.error(error.message ?? i18n.t.users.loadFailed);
      return;
    }
    users = (data?.users ?? []) as Row[];
    total = data?.total ?? users.length;
  }

  async function act(promise: Promise<{ error?: { message?: string } | null }>, ok: string): Promise<void> {
    const { error } = await promise;
    if (error) toast.error(error.message ?? i18n.t.users.actionFailed);
    else {
      toast.success(ok);
      await load();
    }
  }

  const setRole = (u: Row, role: "user" | "admin") =>
    act(api.auth.admin.setRole({ userId: u.id, role }), fmt(i18n.t.users.roleSet, { role }));
  const ban = (u: Row) => act(api.auth.admin.banUser({ userId: u.id }), i18n.t.users.userBanned);
  const unban = (u: Row) => act(api.auth.admin.unbanUser({ userId: u.id }), i18n.t.users.userUnbanned);
  const revoke = (u: Row) => act(api.auth.admin.revokeUserSessions({ userId: u.id }), i18n.t.users.sessionsRevoked);

  function searchInput(event: Event): void {
    search = (event.target as HTMLInputElement).value;
    offset = 0;
    void load();
  }

  $effect(() => {
    void load();
  });
</script>

<div class="flex flex-col gap-4">
  <h1 class="text-2xl font-semibold">{i18n.t.users.title}</h1>
  <Input placeholder={i18n.t.users.search} value={search} oninput={searchInput} class="max-w-xs" />

  <div class="rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{i18n.t.users.name}</Table.Head>
          <Table.Head>{i18n.t.users.email}</Table.Head>
          <Table.Head>{i18n.t.users.role}</Table.Head>
          <Table.Head>{i18n.t.users.status}</Table.Head>
          <Table.Head class="w-10"></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each users as user (user.id)}
          <Table.Row>
            <Table.Cell class="font-medium">{user.name}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{user.email}</Table.Cell>
            <Table.Cell><Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role ?? "user"}</Badge></Table.Cell>
            <Table.Cell>
              {#if user.banned}<Badge variant="destructive">{i18n.t.users.banned}</Badge>{:else}<Badge variant="outline">{i18n.t.users.active}</Badge>{/if}
            </Table.Cell>
            <Table.Cell>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}
                    <Button {...props} variant="ghost" size="icon"><EllipsisIcon class="size-4" /></Button>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  {#if user.role === "admin"}
                    <DropdownMenu.Item onSelect={() => setRole(user, "user")}>{i18n.t.users.makeUser}</DropdownMenu.Item>
                  {:else}
                    <DropdownMenu.Item onSelect={() => setRole(user, "admin")}>{i18n.t.users.makeAdmin}</DropdownMenu.Item>
                  {/if}
                  {#if user.banned}
                    <DropdownMenu.Item onSelect={() => unban(user)}>{i18n.t.users.unban}</DropdownMenu.Item>
                  {:else}
                    <DropdownMenu.Item onSelect={() => ban(user)}>{i18n.t.users.ban}</DropdownMenu.Item>
                  {/if}
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onSelect={() => revoke(user)}>{i18n.t.users.revokeSessions}</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row><Table.Cell colspan={5} class="text-muted-foreground py-8 text-center">{i18n.t.users.empty}</Table.Cell></Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>

  <div class="flex items-center justify-between">
    <span class="text-muted-foreground text-sm">{fmt(i18n.t.users.total, { count: total })}</span>
    <div class="flex gap-2">
      <Button variant="outline" size="sm" disabled={offset === 0 || loading} onclick={() => { offset = Math.max(0, offset - PAGE_SIZE); void load(); }}>{i18n.t.users.previous}</Button>
      <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total || loading} onclick={() => { offset += PAGE_SIZE; void load(); }}>{i18n.t.users.next}</Button>
    </div>
  </div>
</div>
