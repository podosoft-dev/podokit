<script lang="ts">
  // Owned landing page — restyle freely; podo update won't touch it. The top nav
  // is built from the installed content modules (collections from data, plus
  // blog/faq etc. registered in $lib/content-nav), so it grows as you add content.
  import { Button } from "$lib/components/ui/button";
  import * as NavigationMenu from "$lib/components/ui/navigation-menu";
  import LanguageSwitch from "$lib/components/language-switch.svelte";
  import ThemeToggle from "$lib/components/theme-toggle.svelte";
  import SiteFooter from "$lib/components/site-footer.svelte";
  import { contentNavEntries } from "$lib/content-nav.svelte";
  import { getI18n } from "$lib/i18n";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const i18n = getI18n();
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
</script>

<div class="flex min-h-svh flex-col">
  <header class="flex items-center justify-between gap-2 border-b px-4 py-3">
    <nav class="min-w-0">
      <NavigationMenu.Root>
        <NavigationMenu.List class="flex-wrap">
          {#each data.collections as collection (collection)}
            <NavigationMenu.Item>
              <NavigationMenu.Link href={`/collections/${collection}`}>{cap(collection)}</NavigationMenu.Link>
            </NavigationMenu.Item>
          {/each}
          {#each contentNavEntries as entry (entry.href)}
            <NavigationMenu.Item>
              <NavigationMenu.Link href={entry.href}>{entry.label(i18n.t)}</NavigationMenu.Link>
            </NavigationMenu.Item>
          {/each}
        </NavigationMenu.List>
      </NavigationMenu.Root>
    </nav>
    <div class="flex shrink-0 items-center gap-2">
      <LanguageSwitch />
      <ThemeToggle />
    </div>
  </header>

  <main class="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
    <div class="flex flex-col gap-3">
      <h1 class="text-3xl font-semibold">{i18n.t.landing.title}</h1>
      <p class="text-muted-foreground max-w-md">{i18n.t.landing.subtitle}</p>
    </div>
    <Button href="/admin">{i18n.t.landing.openAdmin}</Button>
  </main>
  <SiteFooter />
</div>
