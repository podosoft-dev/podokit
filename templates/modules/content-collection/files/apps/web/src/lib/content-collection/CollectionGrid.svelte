<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import type { CollectionItem } from "./types";

  // Reusable card grid for a collection. Owned pages pass items and the base
  // href to link to detail pages; restyle by wrapping or replacing in your page.
  let {
    items,
    hrefBase,
  }: { items: CollectionItem[]; hrefBase: string } = $props();
</script>

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
  {#each items as item (item.id)}
    <a href={`${hrefBase}/${item.slug}`} class="block">
      <Card.Root class="hover:border-primary/50 h-full transition-colors">
        {#if item.image}
          <img src={item.image} alt={item.title} class="h-40 w-full rounded-t-xl object-cover" />
        {/if}
        <Card.Header>
          <Card.Title>{item.title}</Card.Title>
          {#if item.summary}
            <Card.Description>{item.summary}</Card.Description>
          {/if}
        </Card.Header>
      </Card.Root>
    </a>
  {/each}
</div>
