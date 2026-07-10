<script lang="ts">
  // Owned public detail page — restyle freely; podo update won't touch it.
  import { CollectionDetail } from "$lib/content-collection";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<div class="mx-auto min-h-svh max-w-3xl px-4 py-12">
  <CollectionDetail item={data.item} />
</div>
