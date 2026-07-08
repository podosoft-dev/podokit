<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import * as Table from "$lib/components/ui/table";
  import DataTable, { type DataTableColumn, type SortState } from "$lib/components/data-table.svelte";
  import { toast } from "svelte-sonner";
  import { getI18n, fmt, formatDateTime } from "$lib/i18n";

  const i18n = getI18n();
  type Entry = {
    id: string;
    action: string;
    actorId: string | null;
    actorName: string | null;
    actorEmail: string | null;
    targetLabel: string | null;
    ip: string | null;
    createdAt: string;
  };

  let entries = $state<Entry[]>([]);
  let page = $state(1);
  let sort = $state<SortState | null>({ key: "createdAt", dir: "desc" });

  const columns: DataTableColumn<Entry>[] = [
    { key: "createdAt", label: i18n.t.audit.when, sortable: true, class: "whitespace-nowrap" },
    { key: "actor", label: i18n.t.audit.actor, sortable: true, value: (e) => e.actorName ?? e.actorEmail },
    { key: "action", label: i18n.t.audit.action, sortable: true },
    { key: "target", label: i18n.t.audit.target, sortable: true, value: (e) => e.targetLabel },
    { key: "ip", label: i18n.t.audit.ip, sortable: true },
  ];

  async function load(): Promise<void> {
    try {
      const res = await fetch("/api/audit-logs");
      if (!res.ok) throw new Error();
      entries = (await res.json()) as Entry[];
    } catch {
      toast.error(i18n.t.audit.loadFailed);
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="flex flex-col gap-4">
  <h1 class="text-2xl font-semibold">{i18n.t.audit.title}</h1>

  <DataTable
    {columns}
    rows={entries}
    getKey={(e) => e.id}
    empty={i18n.t.audit.empty}
    bind:sort
    bind:page
    perPage={10}
    label={fmt(i18n.t.audit.total, { count: entries.length })}
  >
    {#snippet row(e)}
      <Table.Cell class="text-muted-foreground whitespace-nowrap">{formatDateTime(e.createdAt)}</Table.Cell>
      <Table.Cell>
        {#if e.actorName || e.actorEmail}
          <div class="font-medium">{e.actorName ?? e.actorEmail}</div>
          {#if e.actorName && e.actorEmail}<div class="text-muted-foreground text-xs">{e.actorEmail}</div>{/if}
        {:else}
          <span class="text-muted-foreground">—</span>
        {/if}
      </Table.Cell>
      <Table.Cell><Badge variant="secondary" class="font-mono text-xs">{e.action}</Badge></Table.Cell>
      <Table.Cell class="max-w-xs truncate">{e.targetLabel ?? "—"}</Table.Cell>
      <Table.Cell class="text-muted-foreground">{e.ip ?? "—"}</Table.Cell>
    {/snippet}
  </DataTable>
</div>
