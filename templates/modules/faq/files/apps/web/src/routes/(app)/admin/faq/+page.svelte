<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import { Switch } from "$lib/components/ui/switch";
  import { Textarea } from "$lib/components/ui/textarea";
  import * as Table from "$lib/components/ui/table";
  import * as Dialog from "$lib/components/ui/dialog";
  import DataTable, { type DataTableColumn, type SortState, DEFAULT_PAGE_SIZE } from "$lib/components/data-table.svelte";
  import TableToolbar, { type ToolbarFilter, type ToolbarSearchField } from "$lib/components/table-toolbar.svelte";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n, fmt } from "$lib/i18n";
  import type { FaqItem } from "$lib/faq";

  const i18n = getI18n();
  const t = $derived(i18n.t.faq);

  let rows = $state<FaqItem[]>([]);
  let loading = $state(true);
  let sort = $state<SortState>({ key: "order", dir: "asc" });
  let page = $state(1);

  async function load(): Promise<void> {
    loading = true;
    try {
      rows = await api.get<FaqItem[]>("/admin/faq");
    } catch {
      rows = [];
    }
    loading = false;
  }
  $effect(() => {
    load();
  });

  let filterValues = $state<Record<string, string>>({ category: "", published: "" });
  let searchField = $state("question");
  let search = $state("");
  let applied = $state({ category: "", published: "", search: "" });
  function applySearch(): void {
    applied = { category: filterValues.category ?? "", published: filterValues.published ?? "", search: search.trim() };
  }

  const categories = $derived([...new Set(rows.map((r) => r.category))].sort());
  const filters = $derived<ToolbarFilter[]>([
    {
      key: "category",
      label: t.category,
      options: [{ value: "", label: i18n.t.toolbar.all }, ...categories.map((c) => ({ value: c, label: c }))],
    },
    {
      key: "published",
      label: t.published,
      options: [
        { value: "", label: i18n.t.toolbar.all },
        { value: "true", label: t.yes },
        { value: "false", label: t.no },
      ],
    },
  ]);
  const searchFields: ToolbarSearchField[] = [{ value: "question", label: "Question" }];

  const filtered = $derived(
    rows.filter((r) => {
      if (applied.category && r.category !== applied.category) return false;
      if (applied.published && String(r.published) !== applied.published) return false;
      if (applied.search && !r.question.toLowerCase().includes(applied.search.toLowerCase())) return false;
      return true;
    }),
  );

  const columns = $derived<DataTableColumn<FaqItem>[]>([
    { key: "question", label: t.question, sortable: true },
    { key: "category", label: t.category, sortable: true },
    { key: "order", label: t.order, sortable: true },
    { key: "published", label: t.published, sortable: true, value: (r: FaqItem) => (r.published ? 1 : 0) },
    { key: "actions", label: "" },
  ]);

  // ── Create / edit dialog ──
  let open = $state(false);
  let editing = $state<FaqItem | null>(null);
  let form = $state({ question: "", answer: "", category: "General", order: 0, published: false });
  let saving = $state(false);

  function openCreate(): void {
    editing = null;
    form = { question: "", answer: "", category: applied.category || "General", order: rows.length, published: false };
    open = true;
  }
  function openEdit(item: FaqItem): void {
    editing = item;
    form = { question: item.question, answer: item.answer, category: item.category, order: item.order, published: item.published };
    open = true;
  }
  async function save(): Promise<void> {
    saving = true;
    try {
      const body = { ...form, order: Number(form.order) };
      if (editing) await api.put(`/admin/faq/${editing.id}`, body);
      else await api.post("/admin/faq", body);
      toast.success(t.saved);
      open = false;
      await load();
    } catch {
      toast.error(t.saveError);
    }
    saving = false;
  }
  async function remove(item: FaqItem): Promise<void> {
    try {
      await api.del(`/admin/faq/${item.id}`);
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

  <DataTable
    {columns}
    rows={filtered}
    getKey={(r) => r.id}
    empty={loading ? t.loading : t.empty}
    bind:sort
    bind:page
    perPage={DEFAULT_PAGE_SIZE}
    label={fmt(t.total, { count: filtered.length })}
  >
    {#snippet row(item)}
      <Table.Cell class="max-w-md truncate font-medium">{item.question}</Table.Cell>
      <Table.Cell class="text-muted-foreground">{item.category}</Table.Cell>
      <Table.Cell>{item.order}</Table.Cell>
      <Table.Cell>
        {#if item.published}<Badge>{t.yes}</Badge>{:else}<Badge variant="secondary">{t.no}</Badge>{/if}
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
      <div class="flex flex-col gap-1.5"><Label for="f-q">{t.question}</Label><Input id="f-q" bind:value={form.question} /></div>
      <div class="flex flex-col gap-1.5"><Label for="f-a">{t.answer}</Label><Textarea id="f-a" bind:value={form.answer} rows={6} /></div>
      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1.5"><Label for="f-cat">{t.category}</Label><Input id="f-cat" bind:value={form.category} /></div>
        <div class="flex flex-col gap-1.5"><Label for="f-order">{t.order}</Label><Input id="f-order" type="number" bind:value={form.order} /></div>
      </div>
      <label class="flex items-center justify-between gap-3 text-sm font-medium">{t.published}<Switch bind:checked={form.published} aria-label={t.published} /></label>
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>{t.cancel}</Button>
      <Button disabled={saving || !form.question} onclick={save}>{saving ? t.saving : t.save}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
