<script lang="ts">
  // Owned public FAQ page — restyle freely; podo update won't touch it.
  import { FaqAccordion } from "$lib/faq";
  import { getI18n } from "$lib/i18n";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const i18n = getI18n();
</script>

<div class="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-4 py-12">
  <h1 class="text-3xl font-semibold">{i18n.t.faq.title_}</h1>
  <FaqAccordion items={data.items} />
</div>
