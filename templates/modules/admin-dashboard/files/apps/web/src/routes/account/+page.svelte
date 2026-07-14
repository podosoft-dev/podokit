<script lang="ts">
  import AccountPage from "$lib/components/account-page.svelte";
  import LanguageSwitch from "$lib/components/language-switch.svelte";
  import SiteFooter from "$lib/components/site-footer.svelte";
  import ThemeToggle from "$lib/components/theme-toggle.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Toaster } from "$lib/components/ui/sonner";
  import { getI18n } from "$lib/i18n";
  import type { Capabilities } from "@podosoft/podokit-api-client";
  import type { SessionUser } from "../../app.d.ts";

  let {
    data,
  }: {
    data: { user: SessionUser; currentSessionId: string | null; capabilities: Capabilities };
  } = $props();
  const i18n = getI18n();
</script>

<div class="flex min-h-svh flex-col">
  <header class="flex h-14 items-center gap-2 border-b px-4">
    <Button href="/" variant="ghost">{i18n.t.nav.home}</Button>
    <div class="flex-1"></div>
    {#if data.user.role === "admin"}
      <Button href="/admin" variant="outline">{i18n.t.common.appName}</Button>
    {/if}
    <LanguageSwitch />
    <ThemeToggle />
  </header>
  <main class="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
    <AccountPage {data} />
  </main>
  <SiteFooter />
</div>
<Toaster />
