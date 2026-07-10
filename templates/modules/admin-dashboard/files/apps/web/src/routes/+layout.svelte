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
  // Prefer live store values (patched after a save); fall back to the server load
  // so SSR renders the saved branding too. Empty falls back to the app.html default.
  const branding = $derived({
    name: site.value.name ?? data.site?.name ?? "",
    hasFavicon: site.value.hasFavicon || Boolean(data.site?.hasFavicon),
    faviconVersion: site.value.faviconVersion ?? data.site?.faviconVersion ?? "",
  });
  // Apply the site name to the browser tab live (avoids a duplicate <title> vs
  // the app.html default; the default project name stays as the SSR fallback).
  $effect(() => {
    if (branding.name) document.title = branding.name;
  });
</script>

<svelte:head>
  {#if branding.hasFavicon}
    <link rel="icon" href={`/api/site/favicon?v=${branding.faviconVersion}`} />
  {/if}
</svelte:head>

<ModeWatcher />
{@render children()}
