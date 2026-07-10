<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Markdown } from "$lib/markdown";
  import type { Post } from "./types";

  // Reusable post detail: cover, title, meta, and the Markdown body rendered
  // safely (sanitized). Owned pages arrange/restyle around it.
  let { post }: { post: Post } = $props();

  const fmtDate = (d: string | null): string => (d ? new Date(d).toLocaleDateString() : "");
</script>

<article class="flex flex-col gap-6">
  <header class="flex flex-col gap-3">
    <h1 class="text-3xl font-semibold">{post.title}</h1>
    <div class="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
      {#if post.author}<span>{post.author}</span>{/if}
      {#if post.publishedAt}<span>· {fmtDate(post.publishedAt)}</span>{/if}
      {#each post.tags as tag (tag)}<Badge variant="outline">{tag}</Badge>{/each}
    </div>
  </header>
  {#if post.coverImage}
    <img src={post.coverImage} alt={post.title} class="w-full rounded-xl object-cover" />
  {/if}
  <Markdown source={post.body} class="prose dark:prose-invert max-w-none" />
</article>
