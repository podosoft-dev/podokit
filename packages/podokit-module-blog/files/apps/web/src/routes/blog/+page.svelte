<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { formatBlogDate } from "$lib/blog";
  import { getI18n } from "$lib/i18n";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const i18n = getI18n();
</script>

<svelte:head><title>{i18n.t.blog.title}</title></svelte:head>

<main class="mx-auto w-full max-w-4xl px-6 py-12 sm:py-20">
  <header class="flex items-end justify-between gap-6 border-b pb-8">
    <div><h1 class="text-4xl font-semibold tracking-tight">{i18n.t.blog.title}</h1></div>
    {#if data.user}
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="outline" href="/blog/mine">{i18n.t.blog.myPosts}</Button>
        <Button href="/blog/write">{i18n.t.blog.newPost}</Button>
      </div>
    {/if}
  </header>

  {#if data.posts.items.length === 0}
    <p class="text-muted-foreground py-16">{i18n.t.blog.empty}</p>
  {:else}
    <ul class="divide-y">
      {#each data.posts.items as post (post.id)}
        <li class="py-7">
          <a class="group block" href="/blog/{post.slug}">
            <div class="text-muted-foreground mb-2 flex flex-wrap items-center gap-3 text-sm">
              <span>{formatBlogDate(post.publishedAt, i18n.locale)}</span>
              <span>{post.author}</span>
            </div>
            <h2 class="group-hover:text-primary text-2xl font-semibold tracking-tight">{post.title}</h2>
            {#if post.excerpt}<p class="text-muted-foreground mt-2 leading-7">{post.excerpt}</p>{/if}
            {#if post.tags.length}
              <div class="mt-4 flex flex-wrap gap-2">
                {#each post.tags as tag (tag)}<Badge variant="secondary">{tag}</Badge>{/each}
              </div>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  {#if data.posts.totalPages > 1}
    <nav class="flex items-center justify-between border-t pt-6" aria-label={i18n.t.blog.title}>
      <Button variant="outline" href={`?page=${data.posts.page - 1}`} disabled={data.posts.page <= 1}>{i18n.t.blog.previous}</Button>
      <span class="text-muted-foreground text-sm">{data.posts.page} / {data.posts.totalPages}</span>
      <Button variant="outline" href={`?page=${data.posts.page + 1}`} disabled={data.posts.page >= data.posts.totalPages}>{i18n.t.blog.next}</Button>
    </nav>
  {/if}
</main>
