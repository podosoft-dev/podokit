<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import * as Table from "$lib/components/ui/table";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import TablePagination from "$lib/components/table-pagination.svelte";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n, fmt, formatDateTime } from "$lib/i18n";

  const i18n = getI18n();

  // better-auth has no "list all sessions" endpoint, so fan out listUserSessions
  // over a page of users and flatten. Bounded to USER_LIMIT users — adequate for a
  // starter admin view; paginate/scope further for large deployments.
  const USER_LIMIT = 50;
  type Row = {
    id: string;
    token: string;
    userId: string;
    userName: string;
    userEmail: string;
    userAgent?: string | null;
    ipAddress?: string | null;
    createdAt: string | Date;
  };

  const PAGE_SIZE = 5;
  let rows = $state<Row[]>([]);
  let page = $state(1);
  let loading = $state(false);
  let busy = $state(false);
  const pagedRows = $derived(rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));

  async function load(): Promise<void> {
    loading = true;
    const { data, error } = await api.auth.admin.listUsers({ query: { limit: USER_LIMIT, offset: 0 } });
    if (error) {
      loading = false;
      toast.error(error.message ?? i18n.t.adminSessions.loadFailed);
      return;
    }
    const users = (data?.users ?? []) as Array<{ id: string; name: string; email: string }>;
    const perUser = await Promise.all(
      users.map(async (u) => {
        const { data: res } = await api.auth.admin.listUserSessions({ userId: u.id });
        const sessions = (res?.sessions ?? []) as Array<Omit<Row, "userId" | "userName" | "userEmail">>;
        return sessions.map((s) => ({ ...s, userId: u.id, userName: u.name, userEmail: u.email }));
      }),
    );
    rows = perUser.flat();
    loading = false;
  }

  async function act(promise: Promise<{ error?: { message?: string } | null }>, ok: string): Promise<void> {
    busy = true;
    const { error } = await promise;
    busy = false;
    if (error) toast.error(error.message ?? i18n.t.adminSessions.loadFailed);
    else {
      toast.success(ok);
      await load();
    }
  }

  const revoke = (row: Row) =>
    act(api.auth.admin.revokeUserSession({ sessionToken: row.token }), i18n.t.adminSessions.revoked);
  const revokeAll = (row: Row) =>
    act(api.auth.admin.revokeUserSessions({ userId: row.userId }), i18n.t.adminSessions.allRevoked);

  $effect(() => {
    void load();
  });
</script>

<div class="flex flex-col gap-4">
  <h1 class="text-2xl font-semibold">{i18n.t.adminSessions.title}</h1>

  <div class="rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{i18n.t.adminSessions.user}</Table.Head>
          <Table.Head>{i18n.t.adminSessions.device}</Table.Head>
          <Table.Head>{i18n.t.adminSessions.ip}</Table.Head>
          <Table.Head>{i18n.t.adminSessions.since}</Table.Head>
          <Table.Head class="w-10"></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each pagedRows as row (row.id)}
          <Table.Row>
            <Table.Cell>
              <div class="font-medium">{row.userName}</div>
              <div class="text-muted-foreground text-xs">{row.userEmail}</div>
            </Table.Cell>
            <Table.Cell class="max-w-xs truncate">{row.userAgent ?? i18n.t.adminSessions.unknown}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{row.ipAddress ?? "—"}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{formatDateTime(row.createdAt)}</Table.Cell>
            <Table.Cell>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}
                    <Button {...props} variant="ghost" size="icon" disabled={busy}><EllipsisIcon class="size-4" /></Button>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  <DropdownMenu.Item onSelect={() => revoke(row)}>{i18n.t.adminSessions.revoke}</DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => revokeAll(row)}>{i18n.t.adminSessions.revokeAll}</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row><Table.Cell colspan={5} class="text-muted-foreground py-8 text-center">{loading ? "…" : i18n.t.adminSessions.empty}</Table.Cell></Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>

  <TablePagination count={rows.length} perPage={PAGE_SIZE} bind:page label={fmt(i18n.t.adminSessions.total, { count: rows.length })} />
</div>
