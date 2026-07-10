<script lang="ts">
  import { Markdown } from "$lib/markdown";
  import type { CollectionItem } from "./types";

  // Reusable detail view: title, optional hero image, and the Markdown body
  // rendered safely (sanitized). Owned pages arrange/restyle around it.
  let { item }: { item: CollectionItem } = $props();
</script>

<article class="flex flex-col gap-6">
  <header class="flex flex-col gap-2">
    <h1 class="text-3xl font-semibold">{item.title}</h1>
    {#if item.summary}
      <p class="text-muted-foreground text-lg">{item.summary}</p>
    {/if}
  </header>
  {#if item.image}
    <img src={item.image} alt={item.title} class="w-full rounded-xl object-cover" />
  {/if}
  <Markdown source={item.body} class="prose dark:prose-invert max-w-none" />
</article>
