<script lang="ts">
  import { setMode, userPrefersMode } from "mode-watcher";
  import SunIcon from "@lucide/svelte/icons/sun";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import MonitorIcon from "@lucide/svelte/icons/monitor";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="icon" aria-label="Toggle theme">
        <SunIcon class="size-4 dark:hidden" />
        <MoonIcon class="hidden size-4 dark:block" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    <DropdownMenu.Item onSelect={() => setMode("light")}><SunIcon class="mr-2 size-4" /> Light</DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => setMode("dark")}><MoonIcon class="mr-2 size-4" /> Dark</DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => setMode("system")}><MonitorIcon class="mr-2 size-4" /> System</DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
{#if userPrefersMode.current}{/if}
