<script lang="ts">
  import "../app.css";
  import { ModeWatcher } from "mode-watcher";
  import { setI18nContext } from "$lib/i18n";
  import { messages, resolveLocale } from "$lib/i18n/messages";
  import { site } from "$lib/site.svelte";

  let { children, data } = $props();
  const locale = $derived(resolveLocale(data.locale));
  setI18nContext({
    get t() {
      return messages[locale];
    },
    get locale() {
      return locale;
    },
  });

  // Seed the reactive site branding; the general-settings form patches it live.
  $effect.pre(() => site.init(data.site));
</script>

<svelte:head>
  {#if site.value.name}<title>{site.value.name}</title>{/if}
  {#if site.value.hasFavicon}
    <link rel="icon" href={`/api/site/favicon?v=${site.value.faviconVersion ?? ""}`} />
  {/if}
</svelte:head>

<ModeWatcher />
{@render children()}
