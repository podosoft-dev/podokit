<script lang="ts">
  import { page } from "$app/state";
  import AccountMenu from "$lib/components/account-menu.svelte";
  import { Button } from "$lib/components/ui/button";
  import LanguageSwitch from "$lib/components/language-switch.svelte";
  import ThemeToggle from "$lib/components/theme-toggle.svelte";
  import SiteFooter from "$lib/components/site-footer.svelte";
  import { getI18n } from "$lib/i18n";

  const i18n = getI18n();
  const user = $derived(page.data.user ?? null);
</script>

<div class="flex min-h-svh flex-col">
  <header class="flex items-center justify-end gap-2 p-4">
    <LanguageSwitch />
    <ThemeToggle />
    <AccountMenu {user} />
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
