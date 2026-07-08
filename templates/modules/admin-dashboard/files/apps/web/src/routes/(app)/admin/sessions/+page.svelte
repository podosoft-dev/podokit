<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import * as Table from "$lib/components/ui/table";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import DataTable, { type DataTableColumn, type SortState } from "$lib/components/data-table.svelte";
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

  let rows = $state<Row[]>([]);
  let page = $state(1);
  let sort = $state<SortState | null>({ key: "createdAt", dir: "desc" });
  let loading = $state(false);
  let busy = $state(false);

  const columns: DataTableColumn<Row>[] = [
    { key: "user", label: i18n.t.adminSessions.user, sortable: true, value: (r) => r.userName },
    { key: "device", label: i18n.t.adminSessions.device, sortable: true, value: (r) => r.userAgent },
    { key: "ip", label: i18n.t.adminSessions.ip, sortable: true, value: (r) => r.ipAddress },
    { key: "createdAt", label: i18n.t.adminSessions.since, sortable: true },
    { key: "actions", label: "", class: "w-10" },
  ];

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

  <DataTable
    {columns}
    {rows}
    getKey={(r) => r.id}
    empty={loading ? "…" : i18n.t.adminSessions.empty}
    bind:sort
    bind:page
    perPage={5}
    label={fmt(i18n.t.adminSessions.total, { count: rows.length })}
  >
    {#snippet row(r)}
      <Table.Cell>
        <div class="font-medium">{r.userName}</div>
        <div class="text-muted-foreground text-xs">{r.userEmail}</div>
      </Table.Cell>
      <Table.Cell class="max-w-xs truncate">{r.userAgent ?? i18n.t.adminSessions.unknown}</Table.Cell>
      <Table.Cell class="text-muted-foreground">{r.ipAddress ?? "—"}</Table.Cell>
      <Table.Cell class="text-muted-foreground">{formatDateTime(r.createdAt)}</Table.Cell>
      <Table.Cell>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button {...props} variant="ghost" size="icon" disabled={busy}><EllipsisIcon class="size-4" /></Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item onSelect={() => revoke(r)}>{i18n.t.adminSessions.revoke}</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => revokeAll(r)}>{i18n.t.adminSessions.revokeAll}</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Table.Cell>
    {/snippet}
  </DataTable>
</div>
