<script lang="ts">
  import { goto } from "$app/navigation";
  import type { BlogPost } from "$lib/blog";
  import DataTable, { type DataTableColumn, type SortState } from "$lib/components/data-table.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import * as Table from "$lib/components/ui/table";
  import { fmt, getI18n } from "$lib/i18n";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const i18n = getI18n();
  let sort = $state<SortState | null>({ key: "updatedAt", dir: "desc" });

  const columns = $derived<DataTableColumn<BlogPost>[]>([
    { key: "title", label: i18n.t.blog.postTitle, sortable: true },
    { key: "status", label: i18n.t.blog.status, sortable: true },
    { key: "updatedAt", label: i18n.t.blog.updated, sortable: true },
    { key: "actions", label: "" },
  ]);
</script>

<svelte:head>
  <title>{i18n.t.blog.myPosts}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto w-full max-w-5xl px-6 py-12 sm:py-20">
  <header class="mb-8 flex items-center justify-between gap-4">
    <h1 class="text-3xl font-semibold tracking-tight">{i18n.t.blog.myPosts}</h1>
    <Button href="/blog/write">{i18n.t.blog.newPost}</Button>
  </header>

  <DataTable
    {columns}
    rows={data.posts.items}
    getKey={(post) => post.id}
    bind:sort
    page={data.posts.page}
    perPage={data.posts.pageSize}
    total={data.posts.total}
    manualPagination
    empty={i18n.t.blog.empty}
    label={fmt(i18n.t.blog.total, { count: data.posts.total })}
    onChange={({ page }) => goto(`?page=${page}`)}
  >
    {#snippet row(post)}
      <Table.Cell class="font-medium">{post.title}</Table.Cell>
      <Table.Cell>
        <Badge variant={post.status === "published" ? "default" : "secondary"}>
          {post.status === "published" ? i18n.t.blog.published : i18n.t.blog.draft}
        </Badge>
      </Table.Cell>
      <Table.Cell class="text-muted-foreground">
        {new Date(post.updatedAt).toLocaleDateString(i18n.locale)}
      </Table.Cell>
      <Table.Cell class="text-right">
        <Button size="sm" variant="ghost" href={`/blog/${post.slug}/edit`}>{i18n.t.blog.edit}</Button>
      </Table.Cell>
    {/snippet}
  </DataTable>
</main>
