<script lang="ts">
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { Separator } from "$lib/components/ui/separator";
  import AppSidebar from "$lib/components/app-sidebar.svelte";
  import ThemeToggle from "$lib/components/theme-toggle.svelte";
  import LanguageSwitch from "$lib/components/language-switch.svelte";
  import { Toaster } from "$lib/components/ui/sonner";
  import type { SessionUser } from "../../app.d.ts";

  let { children, data }: { children: import("svelte").Snippet; data: { user: SessionUser } } = $props();
</script>

<Sidebar.Provider>
  <AppSidebar user={data.user} />
  <Sidebar.Inset>
    <header class="flex h-14 items-center gap-2 border-b px-4">
      <Sidebar.Trigger />
      <Separator orientation="vertical" class="mr-2 h-4" />
      <div class="flex-1"></div>
      <LanguageSwitch />
      <ThemeToggle />
    </header>
    <main class="flex-1 overflow-auto p-6">
      {@render children()}
    </main>
  </Sidebar.Inset>
</Sidebar.Provider>
<Toaster />
