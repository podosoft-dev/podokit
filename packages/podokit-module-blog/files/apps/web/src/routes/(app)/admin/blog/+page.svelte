<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import {
    BlogEditor, blogClient, draftFromPost, emptyBlogDraft,
    type BlogDraft, type BlogEditorLabels, type BlogPost,
  } from "$lib/blog";
  import DataTable, { type DataTableColumn, type SortState, DEFAULT_PAGE_SIZE } from "$lib/components/data-table.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Table from "$lib/components/ui/table";
  import { fmt, getI18n } from "$lib/i18n";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const i18n = getI18n();
  let sort = $state<SortState | null>({ key: "publishedAt", dir: "desc" });
  let page = $state(1);
  let dialogOpen = $state(false);
  let deleteTarget = $state<BlogPost | null>(null);
  let editingId = $state<string | null>(null);
  let draft = $state<BlogDraft>({ ...emptyBlogDraft(), status: "draft" });
  let saving = $state(false);

  const columns = $derived<DataTableColumn<BlogPost>[]>([
    { key: "title", label: i18n.t.blog.postTitle, sortable: true },
    { key: "author", label: i18n.t.blog.author, sortable: true },
    { key: "status", label: i18n.t.blog.status, sortable: true },
    { key: "publishedAt", label: i18n.t.blog.published, sortable: true, value: (post) => post.publishedAt ?? "" },
    { key: "actions", label: "" },
  ]);
  const labels = $derived<BlogEditorLabels>({
    title: i18n.t.blog.postTitle, slug: i18n.t.blog.slug, excerpt: i18n.t.blog.excerpt,
    body: i18n.t.blog.body, coverImage: i18n.t.blog.coverImage, tags: i18n.t.blog.tags,
    status: i18n.t.blog.status, published: i18n.t.blog.published, draft: i18n.t.blog.draft,
    write: i18n.t.blog.write, preview: i18n.t.blog.preview, save: i18n.t.blog.save,
    cancel: i18n.t.blog.cancel, addImage: i18n.t.blog.addImage,
    uploadingImage: i18n.t.blog.uploadingImage, imageHelp: i18n.t.blog.imageHelp,
    imageUploadFailed: i18n.t.blog.imageUploadFailed,
  });

  function openCreate(): void {
    editingId = null;
    draft = { ...emptyBlogDraft(), status: "draft" };
    dialogOpen = true;
  }

  function openEdit(post: BlogPost): void {
    editingId = post.id;
    draft = draftFromPost(post);
    dialogOpen = true;
  }

  async function save(value: BlogDraft): Promise<void> {
    saving = true;
    try {
      if (editingId) await blogClient.adminUpdatePost(editingId, value);
      else await blogClient.adminCreatePost(value);
      toast.success(i18n.t.blog.saved);
      dialogOpen = false;
      await invalidateAll();
    } catch {
      toast.error(i18n.t.blog.saveFailed);
    } finally {
      saving = false;
    }
  }

  async function remove(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await blogClient.adminDeletePost(deleteTarget.id);
      deleteTarget = null;
      toast.success(i18n.t.blog.deleted);
      await invalidateAll();
    } catch {
      toast.error(i18n.t.blog.saveFailed);
    }
  }
</script>

<div class="flex flex-col gap-6 p-6">
  <div class="flex items-center justify-between gap-4">
    <div><h1 class="text-2xl font-semibold tracking-tight">{i18n.t.blog.title}</h1><p class="text-muted-foreground text-sm">{i18n.t.blog.adminSubtitle}</p></div>
    <Button onclick={openCreate}>{i18n.t.blog.newPost}</Button>
  </div>

  <DataTable
    {columns}
    rows={data.posts.items}
    getKey={(post) => post.id}
    bind:sort
    bind:page
    perPage={DEFAULT_PAGE_SIZE}
    label={fmt(i18n.t.blog.total, { count: data.posts.total })}
  >
    {#snippet row(post)}
      <Table.Cell class="font-medium">{post.title}</Table.Cell>
      <Table.Cell>{post.author}</Table.Cell>
      <Table.Cell><Badge variant={post.status === "published" ? "default" : "secondary"}>{post.status === "published" ? i18n.t.blog.published : i18n.t.blog.draft}</Badge></Table.Cell>
      <Table.Cell class="text-muted-foreground">{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString(i18n.locale) : "—"}</Table.Cell>
      <Table.Cell class="text-right"><Button size="sm" variant="ghost" onclick={() => openEdit(post)}>{i18n.t.blog.edit}</Button><Button size="sm" variant="ghost" class="text-destructive" onclick={() => (deleteTarget = post)}>{i18n.t.blog.delete}</Button></Table.Cell>
    {/snippet}
  </DataTable>
</div>

<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
    <Dialog.Header><Dialog.Title>{editingId ? i18n.t.blog.editPost : i18n.t.blog.newPost}</Dialog.Title></Dialog.Header>
    <BlogEditor bind:value={draft} {labels} admin submitting={saving} onsubmit={save} oncancel={() => (dialogOpen = false)} />
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root open={deleteTarget !== null} onOpenChange={(open) => { if (!open) deleteTarget = null; }}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header><Dialog.Title>{i18n.t.blog.deletePostTitle}</Dialog.Title><Dialog.Description>{i18n.t.blog.deleteDescription}</Dialog.Description></Dialog.Header>
    <Dialog.Footer><Button variant="outline" onclick={() => (deleteTarget = null)}>{i18n.t.blog.cancel}</Button><Button variant="destructive" onclick={remove}>{i18n.t.blog.delete}</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
