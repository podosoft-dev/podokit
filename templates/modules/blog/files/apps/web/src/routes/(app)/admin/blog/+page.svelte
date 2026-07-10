<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import { Textarea } from "$lib/components/ui/textarea";
  import * as Table from "$lib/components/ui/table";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import DataTable, { type DataTableColumn, type SortState, DEFAULT_PAGE_SIZE } from "$lib/components/data-table.svelte";
  import TableToolbar, { type ToolbarFilter, type ToolbarSearchField } from "$lib/components/table-toolbar.svelte";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n, fmt, formatDateTime } from "$lib/i18n";
  import type { Post } from "$lib/blog";

  const i18n = getI18n();
  const t = $derived(i18n.t.blog);

  let rows = $state<Post[]>([]);
  let loading = $state(true);
  let sort = $state<SortState>({ key: "createdAt", dir: "desc" });
  let page = $state(1);

  async function load(): Promise<void> {
    loading = true;
    try {
      rows = await api.get<Post[]>("/admin/blog");
    } catch {
      rows = [];
    }
    loading = false;
  }
  $effect(() => {
    load();
  });

  let filterValues = $state<Record<string, string>>({ status: "" });
  let searchField = $state("title");
  let search = $state("");
  let applied = $state({ status: "", searchField: "title", search: "" });
  function applySearch(): void {
    applied = { status: filterValues.status ?? "", searchField, search: search.trim() };
  }

  const filters = $derived<ToolbarFilter[]>([
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
    { value: "author", label: "Author" },
  ];

  const filtered = $derived(
    rows.filter((r) => {
      if (applied.status && r.status !== applied.status) return false;
      if (applied.search) {
        const field = String(r[applied.searchField as "title" | "slug" | "author"] ?? "").toLowerCase();
        if (!field.includes(applied.search.toLowerCase())) return false;
      }
      return true;
    }),
  );

  const columns = $derived<DataTableColumn<Post>[]>([
    { key: "title", label: t.title, sortable: true },
    { key: "slug", label: t.slug, sortable: true },
    { key: "status", label: t.status, sortable: true },
    { key: "publishedAt", label: t.published, sortable: true, value: (p: Post) => p.publishedAt ?? "" },
    { key: "actions", label: "" },
  ]);

  // ── Create / edit dialog ──
  let open = $state(false);
  let editing = $state<Post | null>(null);
  let form = $state({ title: "", slug: "", excerpt: "", body: "", coverImage: "", author: "", tags: "", status: "draft" as "draft" | "published" });
  let saving = $state(false);

  function openCreate(): void {
    editing = null;
    form = { title: "", slug: "", excerpt: "", body: "", coverImage: "", author: "", tags: "", status: "draft" };
    open = true;
  }
  function openEdit(post: Post): void {
    editing = post;
    form = {
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt ?? "",
      body: post.body,
      coverImage: post.coverImage ?? "",
      author: post.author ?? "",
      tags: post.tags.join(", "),
      status: post.status,
    };
    open = true;
  }
  async function save(): Promise<void> {
    saving = true;
    try {
      const body = {
        ...form,
        tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
      };
      if (editing) await api.put(`/admin/blog/${editing.id}`, body);
      else await api.post("/admin/blog", body);
      toast.success(t.saved);
      open = false;
      await load();
    } catch {
      toast.error(t.saveError);
    }
    saving = false;
  }
  async function remove(post: Post): Promise<void> {
    try {
      await api.del(`/admin/blog/${post.id}`);
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
    {#snippet row(post)}
      <Table.Cell class="font-medium">{post.title}</Table.Cell>
      <Table.Cell class="text-muted-foreground">{post.slug}</Table.Cell>
      <Table.Cell>
        <Badge variant={post.status === "published" ? "default" : "secondary"}>{post.status}</Badge>
      </Table.Cell>
      <Table.Cell class="text-muted-foreground">{post.publishedAt ? formatDateTime(post.publishedAt) : "—"}</Table.Cell>
      <Table.Cell class="text-right">
        <Button variant="outline" size="sm" onclick={() => openEdit(post)}>{t.edit}</Button>
        <Button variant="ghost" size="sm" class="text-muted-foreground" onclick={() => remove(post)}>{t.delete}</Button>
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
        <div class="flex flex-col gap-1.5"><Label for="f-title">{t.title}</Label><Input id="f-title" bind:value={form.title} /></div>
        <div class="flex flex-col gap-1.5"><Label for="f-slug">{t.slug}</Label><Input id="f-slug" bind:value={form.slug} /></div>
      </div>
      <div class="flex flex-col gap-1.5"><Label for="f-excerpt">{t.excerpt}</Label><Input id="f-excerpt" bind:value={form.excerpt} /></div>
      <div class="flex flex-col gap-1.5"><Label for="f-body">{t.body}</Label><Textarea id="f-body" bind:value={form.body} rows={10} /></div>
      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1.5"><Label for="f-author">{t.author}</Label><Input id="f-author" bind:value={form.author} /></div>
        <div class="flex flex-col gap-1.5"><Label for="f-cover">{t.coverImage}</Label><Input id="f-cover" bind:value={form.coverImage} /></div>
      </div>
      <div class="flex flex-col gap-1.5"><Label for="f-tags">{t.tags}</Label><Input id="f-tags" bind:value={form.tags} placeholder="news, release" /></div>
      <div class="flex flex-col gap-1.5 sm:w-40">
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
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>{t.cancel}</Button>
      <Button disabled={saving || !form.title || !form.slug} onclick={save}>{saving ? t.saving : t.save}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
