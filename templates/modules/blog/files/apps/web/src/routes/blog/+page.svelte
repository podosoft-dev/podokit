<script lang="ts">
  // Owned public blog list — restyle freely; podo update won't touch it.
  import { PostList } from "$lib/blog";
  import { getI18n } from "$lib/i18n";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const i18n = getI18n();
</script>

<div class="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-4 py-12">
  <h1 class="text-3xl font-semibold">{i18n.t.blog.title_}</h1>
  {#if data.tag}
    <p class="text-muted-foreground text-sm">#{data.tag}</p>
  {/if}
  <PostList posts={data.posts} />
</div>
