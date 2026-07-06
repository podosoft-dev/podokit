<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import * as Table from "$lib/components/ui/table";
  import TablePagination from "$lib/components/table-pagination.svelte";
  import { toast } from "svelte-sonner";
  import { getI18n, fmt, formatDateTime } from "$lib/i18n";

  const i18n = getI18n();
  type Entry = { id: string; userId: string | null; method: string; path: string; statusCode: number; ip: string | null; createdAt: string };

  const PAGE_SIZE = 10;
  let entries = $state<Entry[]>([]);
  let page = $state(1);
  const paged = $derived(entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));

  function statusVariant(code: number): "outline" | "secondary" | "destructive" {
    if (code >= 500) return "destructive";
    if (code >= 400) return "secondary";
    return "outline";
  }

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

  <div class="rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{i18n.t.audit.when}</Table.Head>
          <Table.Head>{i18n.t.audit.method}</Table.Head>
          <Table.Head>{i18n.t.audit.path}</Table.Head>
          <Table.Head>{i18n.t.audit.status}</Table.Head>
          <Table.Head>{i18n.t.audit.user}</Table.Head>
          <Table.Head>{i18n.t.audit.ip}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each paged as e (e.id)}
          <Table.Row>
            <Table.Cell class="text-muted-foreground whitespace-nowrap">{formatDateTime(e.createdAt)}</Table.Cell>
            <Table.Cell class="font-mono text-xs">{e.method}</Table.Cell>
            <Table.Cell class="max-w-xs truncate font-mono text-xs">{e.path}</Table.Cell>
            <Table.Cell><Badge variant={statusVariant(e.statusCode)}>{e.statusCode}</Badge></Table.Cell>
            <Table.Cell class="text-muted-foreground max-w-[10rem] truncate text-xs">{e.userId ?? "—"}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{e.ip ?? "—"}</Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row><Table.Cell colspan={6} class="text-muted-foreground py-8 text-center">{i18n.t.audit.empty}</Table.Cell></Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>

  <TablePagination count={entries.length} perPage={PAGE_SIZE} bind:page label={fmt(i18n.t.audit.total, { count: entries.length })} />
</div>
