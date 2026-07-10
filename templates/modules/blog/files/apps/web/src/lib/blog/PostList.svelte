<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import type { Post } from "./types";

  // Reusable post list. Owned pages pass posts + the base href; restyle freely.
  let { posts, hrefBase = "/blog" }: { posts: Post[]; hrefBase?: string } = $props();

  const fmtDate = (d: string | null): string => (d ? new Date(d).toLocaleDateString() : "");
</script>

<div class="flex flex-col gap-6">
  {#each posts as post (post.id)}
    <a href={`${hrefBase}/${post.slug}`} class="block">
      <Card.Root class="hover:border-primary/50 overflow-hidden transition-colors sm:flex">
        {#if post.coverImage}
          <img src={post.coverImage} alt={post.title} class="h-40 w-full object-cover sm:h-auto sm:w-56" />
        {/if}
        <div class="flex flex-1 flex-col">
          <Card.Header>
            <Card.Title>{post.title}</Card.Title>
            {#if post.excerpt}<Card.Description>{post.excerpt}</Card.Description>{/if}
          </Card.Header>
          <Card.Footer class="text-muted-foreground mt-auto flex flex-wrap items-center gap-2 text-sm">
            {#if post.author}<span>{post.author}</span>{/if}
            {#if post.publishedAt}<span>· {fmtDate(post.publishedAt)}</span>{/if}
            {#each post.tags as tag (tag)}<Badge variant="outline">{tag}</Badge>{/each}
          </Card.Footer>
        </div>
      </Card.Root>
    </a>
  {/each}
</div>
