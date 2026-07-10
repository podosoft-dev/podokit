<script lang="ts">
  import * as Accordion from "$lib/components/ui/accordion";
  import { Markdown } from "$lib/markdown";
  import type { FaqItem } from "./types";

  // Reusable FAQ view: items grouped by category, each an accordion whose answer
  // is rendered as sanitized Markdown. Owned pages restyle around it.
  let { items }: { items: FaqItem[] } = $props();

  const groups = $derived(
    [...new Set(items.map((i) => i.category))].map((category) => ({
      category,
      items: items.filter((i) => i.category === category),
    })),
  );
</script>

<div class="flex flex-col gap-8">
  {#each groups as group (group.category)}
    <section class="flex flex-col gap-2">
      <h2 class="text-lg font-semibold">{group.category}</h2>
      <Accordion.Root type="single">
        {#each group.items as item (item.id)}
          <Accordion.Item value={item.id}>
            <Accordion.Trigger>{item.question}</Accordion.Trigger>
            <Accordion.Content>
              <Markdown source={item.answer} class="prose dark:prose-invert max-w-none" />
            </Accordion.Content>
          </Accordion.Item>
        {/each}
      </Accordion.Root>
    </section>
  {/each}
</div>
