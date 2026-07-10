<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import { Textarea } from "$lib/components/ui/textarea";
  import * as Table from "$lib/components/ui/table";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import DataTable, { type DataTableColumn, type SortState } from "$lib/components/data-table.svelte";
  import TableToolbar, { type ToolbarFilter, type ToolbarSearchField } from "$lib/components/table-toolbar.svelte";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n } from "$lib/i18n";
  import type { CollectionItem } from "$lib/content-collection";

  const i18n = getI18n();
  const t = $derived(i18n.t.collections);

  let rows = $state<CollectionItem[]>([]);
  let loading = $state(true);
  let sort = $state<SortState>({ key: "order", dir: "asc" });
  let page = $state(1);

  async function load(): Promise<void> {
    loading = true;
    try {
      rows = await api.get<CollectionItem[]>("/admin/collections");
    } catch {
      rows = [];
    }
    loading = false;
  }
  $effect(() => {
    load();
  });

  // ── Toolbar: collection + status filters and title/slug search, all applied
  //    together on Search (staged in *Values, committed to `applied`). ──
  let filterValues = $state<Record<string, string>>({ collection: "", status: "" });
  let searchField = $state("title");
  let search = $state("");
  let applied = $state({ collection: "", status: "", searchField: "title", search: "" });
  function applySearch(): void {
    applied = {
      collection: filterValues.collection ?? "",
      status: filterValues.status ?? "",
      searchField,
      search: search.trim(),
    };
  }

  const collectionKeys = $derived([...new Set(rows.map((r) => r.collection))].sort());
  const filters = $derived<ToolbarFilter[]>([
    {
      key: "collection",
      label: t.collection,
      options: [{ value: "", label: i18n.t.toolbar.all }, ...collectionKeys.map((c) => ({ value: c, label: c }))],
    },
    {
      key: "status",
      label: t.status,
      options: [
        { value: "", label: i18n.t.toolbar.all },
        { value: "published", label: "published" },
        { value: "draft", label: "draft" },
      ],
    },
  ]);
  const searchFields: ToolbarSearchField[] = [
    { value: "title", label: "Title" },
    { value: "slug", label: "Slug" },
  ];

  const filtered = $derived(
    rows.filter((r) => {
      if (applied.collection && r.collection !== applied.collection) return false;
      if (applied.status && r.status !== applied.status) return false;
      if (applied.search) {
        const field = String(r[applied.searchField as "title" | "slug"] ?? "").toLowerCase();
        if (!field.includes(applied.search.toLowerCase())) return false;
      }
      return true;
    }),
  );

  const columns = $derived<DataTableColumn<CollectionItem>[]>([
    { key: "title", label: t.title, sortable: true },
    { key: "collection", label: t.collection, sortable: true },
    { key: "slug", label: t.slug, sortable: true },
    { key: "order", label: t.order, sortable: true },
    { key: "status", label: t.status, sortable: true },
    { key: "actions", label: "" },
  ]);

  // ── Create / edit dialog ──
  let open = $state(false);
  let editing = $state<CollectionItem | null>(null);
  let form = $state({ collection: "services", title: "", slug: "", summary: "", body: "", order: 0, status: "draft" as "draft" | "published" });
  let saving = $state(false);

  function openCreate(): void {
    editing = null;
    form = { collection: applied.collection || "services", title: "", slug: "", summary: "", body: "", order: rows.length, status: "draft" };
    open = true;
  }
  function openEdit(item: CollectionItem): void {
    editing = item;
    form = { collection: item.collection, title: item.title, slug: item.slug, summary: item.summary ?? "", body: item.body, order: item.order, status: item.status };
    open = true;
  }
  async function save(): Promise<void> {
    saving = true;
    try {
      const body = { ...form, order: Number(form.order) };
      if (editing) await api.put(`/admin/collections/${editing.id}`, body);
      else await api.post("/admin/collections", body);
      toast.success(t.saved);
      open = false;
      await load();
    } catch {
      toast.error(t.saveError);
    }
    saving = false;
  }
  async function remove(item: CollectionItem): Promise<void> {
    try {
      await api.del(`/admin/collections/${item.id}`);
      toast.success(t.deleted);
      await load();
    } catch {
      toast.error(t.saveError);
    }
  }
</script>

<div class="flex flex-col gap-6">
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="text-2xl font-semibold">{t.title_}</h1>
      <p class="text-muted-foreground text-sm">{t.subtitle}</p>
    </div>
    <Button onclick={openCreate}><PlusIcon class="mr-1 size-4" />{t.add}</Button>
  </div>

  <TableToolbar
    {filters}
    bind:filterValues
    {searchFields}
    bind:searchField
    bind:search
    filterHeading={i18n.t.toolbar.filter}
    searchHeading={i18n.t.toolbar.search}
    searchButton={i18n.t.toolbar.searchButton}
    onSearch={applySearch}
  />

  <DataTable {columns} rows={filtered} getKey={(r) => r.id} empty={loading ? t.loading : t.empty} bind:sort bind:page>
    {#snippet row(item)}
      <Table.Cell class="font-medium">{item.title}</Table.Cell>
      <Table.Cell class="text-muted-foreground">{item.collection}</Table.Cell>
      <Table.Cell class="text-muted-foreground">{item.slug}</Table.Cell>
      <Table.Cell>{item.order}</Table.Cell>
      <Table.Cell>
        <Badge variant={item.status === "published" ? "default" : "secondary"}>{item.status}</Badge>
      </Table.Cell>
      <Table.Cell class="text-right">
        <Button variant="outline" size="sm" onclick={() => openEdit(item)}>{t.edit}</Button>
        <Button variant="ghost" size="sm" class="text-muted-foreground" onclick={() => remove(item)}>{t.delete}</Button>
      </Table.Cell>
    {/snippet}
  </DataTable>
</div>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85vh] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{editing ? t.editTitle : t.add}</Dialog.Title>
    </Dialog.Header>
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1.5"><Label for="f-collection">{t.collection}</Label><Input id="f-collection" bind:value={form.collection} /></div>
        <div class="flex flex-col gap-1.5"><Label for="f-slug">{t.slug}</Label><Input id="f-slug" bind:value={form.slug} /></div>
      </div>
      <div class="flex flex-col gap-1.5"><Label for="f-title">{t.title}</Label><Input id="f-title" bind:value={form.title} /></div>
      <div class="flex flex-col gap-1.5"><Label for="f-summary">{t.summary}</Label><Input id="f-summary" bind:value={form.summary} /></div>
      <div class="flex flex-col gap-1.5"><Label for="f-body">{t.body}</Label><Textarea id="f-body" bind:value={form.body} rows={8} /></div>
      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1.5"><Label for="f-order">{t.order}</Label><Input id="f-order" type="number" bind:value={form.order} /></div>
        <div class="flex flex-col gap-1.5">
          <Label>{t.status}</Label>
          <Select.Root type="single" bind:value={form.status}>
            <Select.Trigger>{form.status}</Select.Trigger>
            <Select.Content>
              <Select.Item value="draft">draft</Select.Item>
              <Select.Item value="published">published</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
      </div>
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>{t.cancel}</Button>
      <Button disabled={saving || !form.title || !form.slug || !form.collection} onclick={save}>{saving ? t.saving : t.save}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
