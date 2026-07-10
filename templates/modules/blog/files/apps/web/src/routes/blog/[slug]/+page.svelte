<script lang="ts">
  // Owned public post page — restyle freely; podo update won't touch it.
  import { PostDetail } from "$lib/blog";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<div class="mx-auto min-h-svh max-w-3xl px-4 py-12">
  <PostDetail post={data.post} />
</div>
