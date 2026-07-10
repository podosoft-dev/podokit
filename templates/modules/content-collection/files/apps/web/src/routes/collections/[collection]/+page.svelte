<script lang="ts">
  // Owned public list page — restyle freely; podo update won't touch it.
  import { CollectionGrid } from "$lib/content-collection";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<div class="mx-auto flex min-h-svh max-w-6xl flex-col gap-8 px-4 py-12">
  <h1 class="text-3xl font-semibold capitalize">{data.collection}</h1>
  <CollectionGrid items={data.items} hrefBase={`/collections/${data.collection}`} />
</div>
